/**
 * Regenera a base do Stash analyzer: `lib/dados/stash.ts` e o atlas de sprites
 * `public/stash/sprites.png`.
 *
 * Rodar à mão quando sair atualização do jogo, na máquina que tem o cliente do
 * Tibia instalado:
 *
 *     node --experimental-strip-types scripts/atualizar-stash.ts
 *
 * Outra pasta de cliente: `TIBIA_ASSETS=/caminho/assets node ...`.
 *
 * ## De onde vem cada coisa
 *
 * - **Quais itens e os sprites:** os arquivos do CLIENTE do Tibia instalado
 *   (`catalog-content.json`, `appearances-*.dat` e as folhas `sprites-*.bmp.lzma`).
 *   É o pixel exato que o Stash desenha, com todos os tamanhos de pilha. Decisão
 *   do Davi em 2026-09-28, sabendo que ler os arquivos internos do cliente pode
 *   esbarrar no contrato de serviço da CipSoft: os CDNs dos dois wikis barram
 *   script com a Cloudflare, e burlar isso estava fora de questão.
 * - **Dados de cada item** (`npcvalue`, `sellto`, `imbuements`): o infobox do
 *   TibiaWiki (fandom), pela API MediaWiki, 50 páginas por chamada. A junção
 *   com o cliente é pelo `itemid`, não pelo nome.
 * - **Delivery Tasks** (mínimo e máximo exigidos): a página "Delivery Task".
 *
 * O Supply Stash só aceita item empilhável (página "Your Supply Stash" do
 * wiki). No cliente, empilhável é a flag 6 (`cumulative`) do `appearances.dat`.
 *
 * ## Formato dos arquivos do cliente
 *
 * - `appearances-*.dat` é protobuf. Só três campos importam: `Appearance.id`
 *   (1), o `SpriteInfo` dentro do `FrameGroup` (2 → 3, com `sprite_id` no 5) e
 *   o nome (4). Um item empilhável tem padrão 4×2 = 8 sprites, um por faixa de
 *   pilha (1, 2, 3, 4, 5, 10, 25, 50): o Stash mostra o da pilha que você tem,
 *   então TODOS entram no atlas, sem repetir os iguais.
 * - `sprites-*.bmp.lzma`: 24 bytes zerados, a assinatura `70 0a fa 80 24`, o
 *   tamanho comprimido em varint e um LZMA1 cujo cabeçalho traz o tamanho
 *   COMPRIMIDO onde o formato `.lzma` padrão espera o descomprimido — daí o
 *   `xz --format=raw`, com as propriedades lidas do cabeçalho. Dentro, um BMP
 *   384×384 de 32 bits (BGRA, linhas de baixo para cima) com 12×12 sprites.
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import sharp from "sharp";

const ASSETS =
  process.env.TIBIA_ASSETS ?? `${homedir()}/.local/share/CipSoft GmbH/Tibia/packages/Tibia/assets`;
const UA = "lootibia/0.1 (+https://lootibia.vercel.app)";
const FANDOM = "https://tibia.fandom.com/api.php";
const DESTINO_DADOS = "lib/dados/stash.ts";
const DESTINO_ATLAS = "public/stash/sprites.png";

/** Lado do sprite e do slot do Stash, em pixels. */
const LADO = 32;
/** Colunas do atlas. 64 × 32 = 2.048 px de largura. */
const COLUNAS = 64;

const pausa = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Protobuf mínimo: só o que o appearances.dat usa
// ---------------------------------------------------------------------------

type Campo = { n: number; varint?: number; bytes?: Uint8Array };

function lerVarint(b: Uint8Array, i: number): [number, number] {
  let n = 0;
  let mult = 1;
  for (;;) {
    const x = b[i++];
    n += (x & 0x7f) * mult;
    if (!(x & 0x80)) return [n, i];
    mult *= 128;
  }
}

function campos(b: Uint8Array): Campo[] {
  const out: Campo[] = [];
  let i = 0;
  while (i < b.length) {
    const [chave, j] = lerVarint(b, i);
    i = j;
    const n = Math.floor(chave / 8);
    const tipo = chave & 7;
    if (tipo === 0) {
      const [v, k] = lerVarint(b, i);
      out.push({ n, varint: v });
      i = k;
    } else if (tipo === 2) {
      const [tam, k] = lerVarint(b, i);
      out.push({ n, bytes: b.subarray(k, k + tam) });
      i = k + tam;
    } else if (tipo === 5) i += 4;
    else if (tipo === 1) i += 8;
    else throw new Error(`protobuf: tipo de campo ${tipo} inesperado`);
  }
  return out;
}

/** `repeated uint32`, que pode vir empacotado ou um por campo. */
function inteiros(cs: Campo[], n: number): number[] {
  const out: number[] = [];
  for (const c of cs) {
    if (c.n !== n) continue;
    if (c.varint !== undefined) out.push(c.varint);
    else if (c.bytes) {
      let i = 0;
      while (i < c.bytes.length) {
        const [v, j] = lerVarint(c.bytes, i);
        out.push(v);
        i = j;
      }
    }
  }
  return out;
}

interface ItemDoCliente {
  id: number;
  nome: string;
  sprites: number[];
}

function empilhaveisDoCliente(dat: Uint8Array): ItemDoCliente[] {
  const out: ItemDoCliente[] = [];
  for (const topo of campos(dat)) {
    if (topo.n !== 1 || !topo.bytes) continue; // 1 = objetos; 2..4 são outfit, efeito, míssil
    const obj = campos(topo.bytes);
    const flags = obj.find((c) => c.n === 3)?.bytes;
    if (!flags || !campos(flags).some((c) => c.n === 6 && c.varint === 1)) continue;
    const nome = obj.find((c) => c.n === 4)?.bytes;
    if (!nome) continue;
    const sprites: number[] = [];
    for (const grupo of obj.filter((c) => c.n === 2 && c.bytes)) {
      const info = campos(grupo.bytes!).find((c) => c.n === 3)?.bytes;
      if (info) sprites.push(...inteiros(campos(info), 5));
    }
    out.push({ id: obj.find((c) => c.n === 1)!.varint!, nome: new TextDecoder().decode(nome), sprites });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Folhas de sprites
// ---------------------------------------------------------------------------

interface Folha {
  arquivo: string;
  tipo: number;
  primeiro: number;
  ultimo: number;
}

/** A folha inteira, como RGBA de cima para baixo. */
function abrirFolha(arquivo: string): Uint8Array {
  const b = readFileSync(`${ASSETS}/${arquivo}`);
  let i = 0;
  while (b[i] === 0) i++;
  if (b.subarray(i, i + 5).toString("hex") !== "700afa8024") throw new Error(`${arquivo}: assinatura desconhecida`);
  i += 5;
  i = lerVarint(b, i)[1];
  const props = b[i];
  const dic = b.readUInt32LE(i + 1);
  i += 13; // props (1) + dicionário (4) + o "tamanho" de 8 bytes que não é o descomprimido
  const lc = props % 9;
  const lp = Math.floor(props / 9) % 5;
  const pb = Math.floor(props / 45);
  const r = spawnSync("xz", ["--format=raw", `--lzma1=lc=${lc},lp=${lp},pb=${pb},dict=${dic}`, "-d", "-c"], {
    input: b.subarray(i),
    maxBuffer: 8 * 1024 * 1024,
  });
  const bmp = r.stdout;
  if (!bmp || bmp.length < 54 || bmp.toString("latin1", 0, 2) !== "BM") {
    throw new Error(`${arquivo}: xz não devolveu um BMP (${r.stderr?.toString().trim()})`);
  }
  const inicio = bmp.readUInt32LE(10);
  const largura = bmp.readInt32LE(18);
  const altura = bmp.readInt32LE(22);
  if (largura !== 384 || Math.abs(altura) !== 384 || bmp.readUInt16LE(28) !== 32) {
    throw new Error(`${arquivo}: BMP ${largura}×${altura} inesperado`);
  }
  const rgba = new Uint8Array(384 * 384 * 4);
  for (let y = 0; y < 384; y++) {
    // Altura positiva: a primeira linha do arquivo é a de BAIXO da imagem.
    const origem = inicio + (altura > 0 ? 383 - y : y) * 384 * 4;
    for (let x = 0; x < 384; x++) {
      const s = origem + x * 4;
      const d = (y * 384 + x) * 4;
      rgba[d] = bmp[s + 2];
      rgba[d + 1] = bmp[s + 1];
      rgba[d + 2] = bmp[s];
      rgba[d + 3] = bmp[s + 3];
    }
  }
  return rgba;
}

/** Recorta um sprite 32×32 da folha (só folhas do tipo 0, de sprites 32×32). */
function recortar(folha: Uint8Array, indice: number): Buffer {
  const cx = (indice % 12) * LADO;
  const cy = Math.floor(indice / 12) * LADO;
  const out = Buffer.alloc(LADO * LADO * 4);
  for (let y = 0; y < LADO; y++) {
    const s = ((cy + y) * 384 + cx) * 4;
    out.set(folha.subarray(s, s + LADO * 4), y * LADO * 4);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Dados do wiki (fandom)
// ---------------------------------------------------------------------------

// O formato da resposta da API MediaWiki muda com a `action`; cada chamador lê
// só os campos da sua.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function api(params: Record<string, string>): Promise<any> {
  const corpo = new URLSearchParams({ format: "json", formatversion: "2", ...params });
  for (let tentativa = 1; ; tentativa++) {
    try {
      const r = await fetch(FANDOM, {
        method: "POST",
        headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded" },
        body: corpo,
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      if (d.error) throw new Error(`${d.error.code}: ${d.error.info}`);
      await pausa(250);
      return d;
    } catch (e) {
      if (tentativa >= 3) throw new Error(`fandom falhou: ${(e as Error).message}`);
      await pausa(3000 * tentativa);
    }
  }
}

/** "275" → 275; "--", "", "0" e "Negotiable" → null. Zero não é "não vale nada". */
function inteiro(v: string | undefined): number | null {
  const n = Number((v ?? "").replace(/[,.\s]/g, ""));
  return Number.isInteger(n) && n > 0 ? n : null;
}

interface DoWiki {
  titulo: string;
  npcvalue: number | null;
  yasir: boolean;
  imbuement: boolean;
}

/** Infobox de cada item empilhável do wiki, indexado por `itemid`. */
async function dadosDoWiki(): Promise<Map<number, DoWiki>> {
  const titulos: string[] = [];
  let cont: Record<string, string> = {};
  for (;;) {
    const d = await api({
      action: "query",
      list: "categorymembers",
      cmtitle: "Category:Stackable Items",
      cmnamespace: "0",
      cmlimit: "500",
      ...cont,
    });
    titulos.push(...d.query.categorymembers.map((m: { title: string }) => m.title));
    if (!d.continue) break;
    cont = d.continue;
  }

  const porId = new Map<number, DoWiki>();
  for (let i = 0; i < titulos.length; i += 50) {
    process.stdout.write(`\r  infobox ${Math.min(i + 50, titulos.length)}/${titulos.length}`);
    // O texto de 50 páginas passa do teto de tamanho da resposta: a API
    // devolve parte, com `continue`, e as páginas que faltam vêm sem
    // `revisions`. Sem seguir a continuação, ~60% dos itens ficavam sem dado.
    const paginas: { title: string; revisions?: { slots?: { main?: { content?: string } } }[] }[] = [];
    let cont: Record<string, string> = {};
    for (;;) {
      const d = await api({
        action: "query",
        prop: "revisions",
        rvprop: "content",
        rvslots: "main",
        titles: titulos.slice(i, i + 50).join("|"),
        ...cont,
      });
      paginas.push(...d.query.pages.filter((p: { revisions?: unknown }) => p.revisions));
      if (!d.continue) break;
      cont = d.continue;
    }
    for (const p of paginas) {
      const texto: string | undefined = p.revisions?.[0]?.slots?.main?.content;
      if (!texto) continue;
      const c: Record<string, string> = {};
      // `[ \t]`, e não `\s`: com `\s`, um campo vazio (`| article =`) engolia a
      // quebra de linha e levava a linha seguinte como valor — o `itemid` de
      // ~60% dos itens sumia assim.
      for (const m of texto.matchAll(/^\|[ \t]*([a-z0-9_]+)[ \t]*=[ \t]*(.*)$/gim)) c[m[1].toLowerCase()] = m[2].trim();
      const info: DoWiki = {
        titulo: p.title,
        npcvalue: inteiro(c.npcvalue),
        yasir: /\byasir\b/i.test(c.sellto ?? ""),
        imbuement: (c.imbuements ?? "").replace(/-/g, "").trim() !== "",
      };
      for (const id of (c.itemid ?? "").match(/\d+/g) ?? []) porId.set(Number(id), info);
    }
  }
  process.stdout.write("\n");
  return porId;
}

/** Linhas `| {{ilink|X}} || [[X]] || 10 || 20 || 7,000`: nome, mínimo, máximo. */
async function deliveryTasks(): Promise<Map<string, [number, number]>> {
  const d = await api({ action: "parse", page: "Delivery Task", prop: "wikitext" });
  const mapa = new Map<string, [number, number]>();
  for (const linha of (d.parse.wikitext as string).split("\n")) {
    const partes = linha.split("||").map((p) => p.trim());
    if (partes.length < 4) continue;
    const nome = partes[1].match(/\[\[([^\]|#]+)/)?.[1]?.trim();
    const min = inteiro(partes[2]);
    const max = inteiro(partes[3]);
    if (nome && min && max) mapa.set(nome, [min, max]);
  }
  return mapa;
}

// ---------------------------------------------------------------------------

async function main() {
  console.log(`1/4 cliente do Tibia em ${ASSETS} ...`);
  const catalogo = JSON.parse(readFileSync(`${ASSETS}/catalog-content.json`, "utf8")) as {
    type: string;
    file: string;
    spritetype?: number;
    firstspriteid?: number;
    lastspriteid?: number;
  }[];
  const dat = readFileSync(`${ASSETS}/${catalogo.find((e) => e.type === "appearances")!.file}`);
  const doCliente = empilhaveisDoCliente(dat);
  const folhas: Folha[] = catalogo
    .filter((e) => e.type === "sprite")
    .map((e) => ({ arquivo: e.file, tipo: e.spritetype!, primeiro: e.firstspriteid!, ultimo: e.lastspriteid! }));
  console.log(`  ${doCliente.length} itens empilháveis com nome`);

  console.log("2/4 dados de cada item (TibiaWiki) ...");
  const doWiki = await dadosDoWiki();

  console.log("3/4 Delivery Tasks (TibiaWiki) ...");
  const entregas = await deliveryTasks();
  console.log(`  ${entregas.size} itens em Delivery Task`);

  console.log("4/4 sprites ...");
  const abertas = new Map<string, Uint8Array>();
  const sprites: Buffer[] = [];
  const porHash = new Map<string, number>();
  const itens: [string, number | null, number, number, number, number[]][] = [];
  let foraDoPadrao = 0;
  let semWiki = 0;

  for (const it of doCliente) {
    const indices = new Set<number>();
    for (const id of it.sprites) {
      const f = folhas.find((x) => x.primeiro <= id && id <= x.ultimo);
      if (!f) continue;
      if (f.tipo !== 0) {
        foraDoPadrao++; // o Stash desenha 32×32; sprite maior é raríssimo em empilhável
        continue;
      }
      if (!abertas.has(f.arquivo)) abertas.set(f.arquivo, abrirFolha(f.arquivo));
      const px = recortar(abertas.get(f.arquivo)!, id - f.primeiro);
      if (!px.some((_, k) => k % 4 === 3 && px[k] > 0)) continue; // quadro vazio
      const chave = createHash("sha1").update(px).digest("hex");
      let s = porHash.get(chave);
      if (s === undefined) {
        s = sprites.length;
        sprites.push(px);
        porHash.set(chave, s);
      }
      indices.add(s);
    }
    if (indices.size === 0) continue;
    const w = doWiki.get(it.id);
    if (!w) semWiki++;
    const nome = w?.titulo ?? it.nome.replace(/(^|\s)\S/g, (l) => l.toUpperCase());
    const flags = (w?.yasir ? 1 : 0) | (w?.imbuement ? 2 : 0);
    const [min, max] = entregas.get(nome) ?? [0, 0];
    itens.push([nome, w?.npcvalue ?? null, flags, min, max, [...indices]]);
  }
  console.log(`  ${abertas.size} folhas abertas`);

  const linhas = Math.ceil(sprites.length / COLUNAS);
  const atlas = await sharp({
    create: { width: COLUNAS * LADO, height: linhas * LADO, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite(
      sprites.map((raw, i) => ({
        input: raw,
        raw: { width: LADO, height: LADO, channels: 4 as const },
        left: (i % COLUNAS) * LADO,
        top: Math.floor(i / COLUNAS) * LADO,
      })),
    )
    .png({ compressionLevel: 9 })
    .toBuffer();

  itens.sort((a, b) => a[0].localeCompare(b[0]));
  const conteudo = `// GERADO por scripts/atualizar-stash.ts — não editar à mão.
// Sprites: cliente do Tibia (© CipSoft GmbH). Dados: TibiaWiki (tibia.fandom.com).

/** O atlas de sprites que acompanha esta base, em \`public/\`. */
export const ATLAS = {
  url: "/stash/sprites.png",
  lado: ${LADO},
  colunas: ${COLUNAS},
  largura: ${COLUNAS * LADO},
  altura: ${linhas * LADO},
} as const;

/** Bits de \`flags\`. */
export const COMPRA_YASIR = 1;
export const IMBUEMENT = 2;

/**
 * Um item empilhável: \`[nome, npcvalue, flags, deliveryMin, deliveryMax, sprites]\`.
 *
 * Tupla, e não objeto, porque são ${itens.length} itens e o arquivo vai para o
 * navegador. \`npcvalue\` nulo é "sem referência", não zero. \`deliveryMin\` 0 é
 * "não entra em Delivery Task". \`sprites\` são índices no atlas; dois itens
 * podem apontar para o mesmo sprite quando o desenho é idêntico.
 */
export type ItemDoStash = readonly [string, number | null, number, number, number, readonly number[]];

export const ITENS_DO_STASH: readonly ItemDoStash[] = ${JSON.stringify(itens)};
`;

  mkdirSync("public/stash", { recursive: true });
  writeFileSync(DESTINO_ATLAS, atlas);
  writeFileSync(DESTINO_DADOS, conteudo);

  const entregaveis = itens.filter((i) => i[3] > 0).length;
  const naoAchados = [...entregas.keys()].filter((n) => !itens.some((it) => it[0] === n));
  console.log(`\n${itens.length} itens, ${sprites.length} sprites, atlas ${COLUNAS * LADO}×${linhas * LADO}`);
  console.log(`${(atlas.length / 1024).toFixed(0)} KB de atlas, ${(conteudo.length / 1024).toFixed(0)} KB de dados`);
  console.log(`${entregaveis} itens de Delivery Task empilháveis; ${naoAchados.length} de Delivery Task não aparecem (não empilham)`);
  console.log(`${semWiki} itens do cliente sem página no wiki; ${foraDoPadrao} sprites maiores que 32×32 ignorados`);
}

main().catch((e) => {
  console.error("\nFALHOU, nada foi escrito:", e.message);
  process.exit(1);
});
