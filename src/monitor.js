import { chromium } from 'playwright';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';

// Carga simple de .env (sin dependencias extra)
if (existsSync('.env')) {
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const {
  MI_POST_URL,
  RIVAL_POST_URL,
  UMBRAL_ALERTA = '5',
  INTERVALO_SEG = '120',
  TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_ID,
  WEBHOOK_URL,
  REACTION_SELECTOR,
} = process.env;

const ONCE = process.argv.includes('--once');
const DEBUG = process.argv.includes('--debug');
const umbral = Number(UMBRAL_ALERTA);

if (!MI_POST_URL || !RIVAL_POST_URL) {
  console.error('Faltan MI_POST_URL y/o RIVAL_POST_URL (copia .env.example a .env).');
  process.exit(1);
}

// Suma las reacciones visibles de una publicación (likes, votos, estrellas, corazones...).
// Padlet cambia su HTML con frecuencia: si no funciona, usa `npm run debug` y define REACTION_SELECTOR.
async function leerReacciones(page, url, etiqueta) {
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2500);

  const total = await page.evaluate((sel) => {
    const nums = [];
    const candidatos = sel
      ? document.querySelectorAll(sel)
      : document.querySelectorAll(
          '[aria-label*="eact" i], [aria-label*="like" i], [aria-label*="gusta" i], ' +
            '[aria-label*="vote" i], [aria-label*="voto" i], [aria-label*="grade" i], ' +
            '[data-testid*="reaction" i], [class*="reaction" i], [class*="Reaction"]'
        );
    for (const el of candidatos) {
      const txt = `${el.getAttribute('aria-label') ?? ''} ${el.textContent ?? ''}`;
      const m = txt.match(/\b\d+\b/g);
      if (m && txt.length < 80) nums.push(Number(m[m.length - 1]));
    }
    return nums;
  }, REACTION_SELECTOR || null);

  if (DEBUG) {
    mkdirSync('debug', { recursive: true });
    writeFileSync(`debug/${etiqueta}.html`, await page.content());
    await page.screenshot({ path: `debug/${etiqueta}.png`, fullPage: true });
    console.log(`[debug] ${etiqueta}: números encontrados =`, total);
  }

  if (!total.length) throw new Error(`No se encontraron reacciones en ${etiqueta}. Revisa REACTION_SELECTOR.`);
  return total.reduce((a, b) => a + b, 0);
}

async function notificar(texto) {
  console.log(`🔔 ${texto}`);
  const tareas = [];
  if (TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID) {
    tareas.push(
      fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: texto }),
      })
    );
  }
  if (WEBHOOK_URL) {
    tareas.push(
      fetch(WEBHOOK_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // "text" para Slack, "content" para Discord
        body: JSON.stringify({ text: texto, content: texto }),
      })
    );
  }
  await Promise.allSettled(tareas);
}

let ultimoEstado = null; // evita avisar en cada ciclo

async function ciclo(browser) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  try {
    const mias = await leerReacciones(page, MI_POST_URL, 'mi-post');
    const rival = await leerReacciones(page, RIVAL_POST_URL, 'rival');
    const ventaja = mias - rival;
    console.log(`[${new Date().toLocaleTimeString()}] Mías: ${mias} | Rival: ${rival} | Ventaja: ${ventaja}`);

    const estado = ventaja < 0 ? 'perdiendo' : ventaja === 0 ? 'empate' : ventaja <= umbral ? 'cerca' : 'ok';
    if (estado !== ultimoEstado && estado !== 'ok') {
      const msgs = {
        perdiendo: `🚨 Vas perdiendo: ${mias} vs ${rival} (${ventaja}).`,
        empate: `⚠️ Empate a ${mias} reacciones.`,
        cerca: `👀 La rival se acerca: ${mias} vs ${rival} (ventaja ${ventaja}).`,
      };
      await notificar(`${msgs[estado]}\n${MI_POST_URL}`);
    }
    ultimoEstado = estado;
  } catch (e) {
    console.error('Error en el ciclo:', e.message);
  } finally {
    await ctx.close();
  }
}

const browser = await chromium.launch();
do {
  await ciclo(browser);
  if (ONCE) break;
  await new Promise((r) => setTimeout(r, Number(INTERVALO_SEG) * 1000));
} while (true);
await browser.close();
