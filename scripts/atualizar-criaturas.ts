/**
 * Regenera `lib/dados/criaturas.ts` a partir da TibiaData.
 *
 * Este é o ÚNICO lugar do projeto que fala com a api.tibiadata.com (diretriz
 * 15). A tela não chama API nenhuma para mostrar sprite: lê o arquivo gerado.
 *
 * Por que arquivo no repositório e não `fetch` em tempo de requisição:
 * a documentação do Next é explícita de que, com o handler em memória padrão,
 * "serverless instances are ephemeral, so entries may not be reused between
 * requests". Na Vercel isso significaria rebuscar as 718 criaturas a cada
 * carregamento de página, contra um fansite mantido por voluntários — o oposto
 * da diretriz 17. A lista só muda quando o jogo ganha criatura nova, então
 * versionar o resultado é mais honesto do que cachear.
 *
 * Rodar quando sair atualização do jogo:
 *
 *     node --experimental-strip-types scripts/atualizar-criaturas.ts
 *
 * O diff mostra exatamente o que entrou. Se a API falhar, o arquivo atual fica
 * intacto — o script aborta sem escrever.
 */

import { writeFileSync } from "node:fs";

const URL_API = "https://api.tibiadata.com/v4/creatures";
const UA = "lootibia/0.1 (+https://lootibia.vercel.app)";
const DESTINO = "lib/dados/criaturas.ts";

interface CriaturaDaApi {
  name: string;
  race: string;
  image_url: string;
}

async function main() {
  console.log(`buscando ${URL_API} ...`);
  const r = await fetch(URL_API, { headers: { "User-Agent": UA } });

  // Diretriz 16: a TibiaData devolve 502 em text/plain para recurso
  // inexistente e 400 com JSON para erro de validação. O corpo pode não ser
  // JSON, então nunca se parseia direto.
  const texto = await r.text();
  let json: unknown;
  try {
    json = JSON.parse(texto);
  } catch {
    throw new Error(`resposta não é JSON (HTTP ${r.status}): ${texto.slice(0, 120)}`);
  }

  const corpo = json as {
    creatures?: { creature_list?: CriaturaDaApi[] };
    information?: { status?: { http_code?: number; message?: string }; api?: { release?: string } };
  };
  const status = corpo.information?.status;
  if (status?.http_code !== 200) {
    throw new Error(`API respondeu ${status?.http_code}: ${status?.message ?? "sem mensagem"}`);
  }

  const lista = (corpo.creatures?.creature_list ?? []).filter(
    (c) => c?.name && c?.race && c?.image_url,
  );
  if (lista.length < 500) {
    // Sanidade: eram 718 em 2026-09. Uma queda brusca indica resposta
    // truncada ou mudança de formato — melhor abortar do que sobrescrever a
    // lista boa com lixo.
    throw new Error(`só ${lista.length} criaturas vieram; esperado algo perto de 700. Abortando.`);
  }

  lista.sort((a, b) => a.name.localeCompare(b.name));

  const linhas = lista.map(
    (c) => `  [${JSON.stringify(c.name)}, ${JSON.stringify(c.race)}, ${JSON.stringify(c.image_url)}],`,
  );

  const conteudo = `// ARQUIVO GERADO — não editar à mão.
// Origem: ${URL_API} (TibiaData ${corpo.information?.api?.release ?? "?"})
// Gerado em: ${new Date().toISOString().slice(0, 10)}
// Regerar:  node --experimental-strip-types scripts/atualizar-criaturas.ts
//
// Tupla [nome, race, url do sprite]. Tupla e não objeto para o arquivo não
// triplicar de tamanho com nomes de campo repetidos 718 vezes.

export type CriaturaSprite = readonly [nome: string, race: string, imagem: string];

export const CRIATURAS: readonly CriaturaSprite[] = [
${linhas.join("\n")}
];
`;

  writeFileSync(DESTINO, conteudo);
  console.log(`${DESTINO}: ${lista.length} criaturas gravadas.`);
}

main().catch((e) => {
  console.error("FALHOU:", (e as Error).message);
  process.exit(1);
});
