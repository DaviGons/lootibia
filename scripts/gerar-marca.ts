/**
 * Gera os arquivos de imagem da marca a partir de `lib/marca.ts`.
 *
 *     node --experimental-strip-types scripts/gerar-marca.ts
 *
 * Mesma lógica da diretriz 33 e de `atualizar-criaturas.ts`: o resultado é
 * versionado, não gerado em tempo de requisição. Favicon e imagem de OpenGraph
 * mudam quando a marca muda, ou seja, quase nunca — e o diff de um binário
 * pequeno é mais barato que um `ImageResponse` rodando a cada link
 * compartilhado.
 *
 * Escreve:
 *   app/icon.svg              vetorial, é o que navegador moderno usa
 *   app/favicon.ico           16/32/48, para quem não lê SVG
 *   app/apple-icon.png        180x180, atalho de iOS
 *   app/opengraph-image.png   1200x630
 *   app/twitter-image.png     idem (o Next exige os dois arquivos)
 */

import { writeFileSync } from "node:fs";
import sharp from "sharp";
import { CARVAO, CREME, LARANJA, svgDaMarca, svgDoIcone } from "../lib/marca.ts";

const svgIcone = svgDoIcone();

/**
 * Empacota PNGs num contêiner .ICO.
 *
 * O formato aceita PNG embutido desde o Vista, então não há bitmap cru nem
 * máscara AND aqui: cabeçalho de 6 bytes, uma entrada de 16 bytes por tamanho,
 * e os PNGs em seguida. Tamanho 256 se escreve como 0 no campo de um byte —
 * irrelevante para nós, que paramos em 48, mas o `>= 256 ? 0` fica para quem
 * mexer depois não tropeçar.
 */
function empacotarIco(imagens: { lado: number; png: Buffer }[]): Buffer {
  const cabecalho = Buffer.alloc(6);
  cabecalho.writeUInt16LE(0, 0); // reservado
  cabecalho.writeUInt16LE(1, 2); // 1 = ícone
  cabecalho.writeUInt16LE(imagens.length, 4);

  const entradas = Buffer.alloc(16 * imagens.length);
  let deslocamento = 6 + 16 * imagens.length;
  imagens.forEach(({ lado, png }, i) => {
    const o = 16 * i;
    entradas.writeUInt8(lado >= 256 ? 0 : lado, o); // largura
    entradas.writeUInt8(lado >= 256 ? 0 : lado, o + 1); // altura
    entradas.writeUInt8(0, o + 2); // cores da paleta: 0 = sem paleta
    entradas.writeUInt8(0, o + 3); // reservado
    entradas.writeUInt16LE(1, o + 4); // planos
    entradas.writeUInt16LE(32, o + 6); // bits por pixel
    entradas.writeUInt32LE(png.length, o + 8);
    entradas.writeUInt32LE(deslocamento, o + 12);
    deslocamento += png.length;
  });

  return Buffer.concat([cabecalho, entradas, ...imagens.map((i) => i.png)]);
}

/**
 * O cartão social. Sem uma linha de texto de propósito: `sharp` rasteriza SVG
 * fora do navegador e não há garantia de qual fonte a máquina tem instalada —
 * o mesmo motivo de as letras do wordmark serem desenhadas (ver `lib/marca.ts`).
 * Título e descrição já viajam como texto no `<meta>`; a imagem carrega a marca.
 */
function svgSocial(): string {
  const marca = svgDaMarca(CREME)
    .replace(/^<svg[^>]*>/, "")
    .replace(/<\/svg>$/, "");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="${CARVAO}"/>
  <!-- Brilho quente no topo, o mesmo gesto do body em globals.css. -->
  <defs>
    <radialGradient id="calor" cx="50%" cy="0%" r="75%">
      <stop offset="0%" stop-color="${LARANJA}" stop-opacity="0.16"/>
      <stop offset="100%" stop-color="${LARANJA}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#calor)"/>
  <!--
    Wordmark 752x213 (396x112 em escala 1,9) mais um vão de 32 e o traço de 8:
    bloco de 253, centrado na vertical em (630-253)/2 = 188. O traço fica
    rente à esquerda do "l", não centrado — alinhamento à esquerda parece
    decidido, centrado parece sobra.
  -->
  <g transform="translate(224 188) scale(1.9)">${marca}</g>
  <rect x="224" y="433" width="120" height="8" rx="4" fill="${LARANJA}"/>
</svg>`;
}

async function main() {
  // 1. SVG do ícone — o arquivo que navegador moderno prefere.
  writeFileSync("app/icon.svg", svgIcone + "\n");

  // 2. favicon.ico. 48 entra porque é o tamanho da barra de tarefas do Windows.
  const lados = [16, 32, 48];
  const imagens = await Promise.all(
    lados.map(async (lado) => ({
      lado,
      png: await sharp(Buffer.from(svgIcone), { density: 384 })
        .resize(lado, lado)
        .png()
        .toBuffer(),
    })),
  );
  writeFileSync("app/favicon.ico", empacotarIco(imagens));

  // 3. Atalho de iOS. Sem canto arredondado próprio: o iOS recorta sozinho, e
  //    tile com raio embutido ganha um halo escuro na máscara do sistema.
  const quadrado = svgDoIcone(CREME, CARVAO).replace(/rx="\d+(\.\d+)?"/, 'rx="0"');
  await sharp(Buffer.from(quadrado), { density: 720 })
    .resize(180, 180)
    .png()
    .toFile("app/apple-icon.png");

  // 4. Cartão social. Os dois arquivos saem do mesmo desenho; o Next não
  //    deriva um do outro.
  const social = await sharp(Buffer.from(svgSocial()), { density: 96 })
    .png({ compressionLevel: 9 })
    .toBuffer();
  writeFileSync("app/opengraph-image.png", social);
  writeFileSync("app/twitter-image.png", social);

  console.log(
    [
      "app/icon.svg",
      `app/favicon.ico (${lados.join("/")})`,
      "app/apple-icon.png (180)",
      `app/opengraph-image.png + twitter-image.png (1200x630, ${Math.round(social.length / 1024)} kB cada)`,
    ]
      .map((l) => `  ${l}`)
      .join("\n"),
  );
}

main().catch((e) => {
  console.error("FALHOU:", (e as Error).message);
  process.exit(1);
});
