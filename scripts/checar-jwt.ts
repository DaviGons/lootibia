/**
 * Ver docs/bot-discord.md, decisão 3.
 *
 * Prova que o Supabase aceita o token que o bot assina. Rodado à mão:
 *
 *   node --experimental-strip-types --env-file=.env.local scripts/checar-jwt.ts
 *
 * Por que existe: o bot inteiro depende de uma única premissa — o projeto usa
 * chaves assimétricas (ES256), cuja privada não é exportável, então a assinatura
 * é em **HS256 com o segredo legado**. O painel diz que esse segredo é "used only
 * to verify JWTs", o que em tese é exatamente o lado de que precisamos. Este
 * script troca "em tese" por uma resposta HTTP.
 *
 * Se o segredo for revogado um dia, o sintoma no bot é um `401` genérico vindo de
 * qualquer comando. Rodar isto aponta a causa em dois segundos.
 *
 * NÃO imprime o segredo, nem nenhum token inteiro.
 */

import { assinarJwt } from "../lib/supabase/bot.ts";

function exigir(nome: string): string {
  const v = process.env[nome];
  if (!v) {
    console.error(`Falta ${nome}. Rode com --env-file=.env.local, ou exporte a variável.`);
    process.exit(1);
  }
  return v;
}

const url = exigir("NEXT_PUBLIC_SUPABASE_URL");
const publicavel = exigir("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
const segredo = exigir("SUPABASE_JWT_SECRET");

/**
 * Usuário que não existe. É de propósito: o teste é sobre o token ser ACEITO,
 * não sobre haver dado. Com a RLS valendo, a resposta certa é `200 []` — lista
 * vazia porque nenhuma sessão pertence a este uuid.
 */
const USUARIO_FANTASMA = "00000000-0000-0000-0000-000000000000";

async function tentar(rotulo: string, token: string) {
  const r = await fetch(`${url}/rest/v1/sessao?select=id&limit=1`, {
    headers: { apikey: publicavel, Authorization: `Bearer ${token}` },
  });
  const corpo = (await r.text()).slice(0, 200);
  console.log(`  ${rotulo.padEnd(34)} HTTP ${r.status}  ${corpo}`);
  return r.status;
}

console.log("Batendo em /rest/v1/sessao com tokens assinados pelo bot:\n");

const comSegredoCerto = await tentar(
  "segredo do projeto",
  assinarJwt(USUARIO_FANTASMA, segredo),
);

// Controle: sem isto, um 200 não provaria nada — poderia ser o PostgREST
// ignorando o Authorization e caindo na chave publicável.
const comSegredoErrado = await tentar(
  "segredo errado (controle)",
  assinarJwt(USUARIO_FANTASMA, "isto-nao-e-o-segredo-do-projeto"),
);

console.log();

if (comSegredoCerto === 200 && comSegredoErrado === 401) {
  console.log("OK — o Supabase aceita o token do bot e recusa o forjado.");
  console.log("A decisao 3 (JWT assinado, RLS isolando) esta de pe.");
} else if (comSegredoCerto === 401) {
  console.log("FALHOU — o segredo legado nao e mais aceito para verificacao.");
  console.log("Ver docs/bot-discord.md, 'O que a implementacao descobriu'.");
  process.exit(1);
} else if (comSegredoErrado !== 401) {
  console.log("INCONCLUSIVO — o token forjado tambem passou.");
  console.log("Alguma coisa esta aceitando a requisicao sem validar o JWT.");
  process.exit(1);
} else {
  console.log(`INESPERADO — status ${comSegredoCerto} com o segredo certo.`);
  process.exit(1);
}
