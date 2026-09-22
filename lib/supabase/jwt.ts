/**
 * Assina um JWT que o Supabase aceita como sessão de um usuário.
 *
 * ## Por que isto existe, se ninguém faz login por aqui
 *
 * Nasceu em 2026-09-17 para o bot do Discord, que precisava falar pelo usuário
 * sem ter um cookie de sessão. O bot foi aposentado em 2026-09-22 (ver
 * `docs/bot-discord.md`), mas este arquivo **não foi junto**: quem passou a
 * depender dele é `scripts/testar-pastas.ts`, o teste que exercita a RLS pelo
 * mesmo caminho da tela (diretriz 46).
 *
 * E é justamente isso que dá valor ao teste. Usar a chave secreta seria mais
 * fácil e testaria a coisa errada: ela **ignora a RLS**, e a RLS é o que o teste
 * existe para verificar. Assinando um token de usuário de verdade, as políticas
 * valem — e um `update` sem política volta a negar em silêncio, como negou em
 * 21/09 (diretriz 45).
 *
 * ## A ressalva que continua valendo
 *
 * Assina em **HS256, com o segredo JWT legado do projeto**. O Supabase migrou
 * para chaves assimétricas (ES256), cuja privada não é exportável — não dá para
 * assinar com ela. O painel marca o segredo legado como
 * `still used — used only to verify JWTs`: ele parou de *emitir* em HS256, mas
 * continua **verificando**, que é o lado de que precisamos.
 *
 * Verificado contra o projeto real em 2026-09-17: token assinado aqui aceito
 * (`200`), token forjado recusado (`401`).
 *
 * Se o segredo for revogado, `scripts/testar-pastas.ts` passa a falhar com `401`
 * em tudo. A saída é reabilitá-lo no painel, ou reescrever o teste para outra
 * forma de autenticar — nunca para a chave secreta, que anularia o teste.
 *
 * O segredo, obviamente, nunca em `NEXT_PUBLIC_*` (diretriz 26). E ele **não
 * precisa existir na Vercel**: só scripts locais o usam.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { Buffer } from "node:buffer";

/** Validade do token. Curta: é descartado no fim do script que o pediu. */
const VIDA_DO_TOKEN_S = 120;

function base64url(b: Buffer | string): string {
  return Buffer.from(b)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * Assina um JWT HS256 com as claims que o Supabase espera.
 *
 * `role: 'authenticated'` é o que faz o PostgREST trocar para o papel do
 * Postgres em que as políticas `to authenticated` valem. Sem essa claim o token
 * é válido e inútil: cai em `anon`, que não tem política nenhuma — e o sintoma
 * seria um teste "passando" por negar tudo pelo motivo errado.
 *
 * Nada de dependência de JWT: são três base64url e um HMAC.
 */
export function assinarJwt(usuarioId: string, segredo: string, agoraS?: number): string {
  const iat = agoraS ?? Math.floor(Date.now() / 1000);

  const cabecalho = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const corpo = base64url(
    JSON.stringify({
      sub: usuarioId,
      role: "authenticated",
      aud: "authenticated",
      iat,
      exp: iat + VIDA_DO_TOKEN_S,
    }),
  );

  const conteudo = `${cabecalho}.${corpo}`;
  const assinatura = base64url(createHmac("sha256", segredo).update(conteudo).digest());
  return `${conteudo}.${assinatura}`;
}

/**
 * Confere um JWT que esta função assinou.
 *
 * Quem valida de verdade é o Supabase; isto existe para provar, sem rede, que o
 * token sai bem formado.
 */
export function jwtConfere(token: string, segredo: string): boolean {
  const partes = token.split(".");
  if (partes.length !== 3) return false;
  const esperada = base64url(
    createHmac("sha256", segredo).update(`${partes[0]}.${partes[1]}`).digest(),
  );
  const a = Buffer.from(partes[2]);
  const b = Buffer.from(esperada);
  return a.length === b.length && timingSafeEqual(a, b);
}
