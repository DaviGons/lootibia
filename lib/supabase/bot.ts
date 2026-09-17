/**
 * Ver docs/bot-discord.md, decisão 3 ("identidade e RLS").
 *
 * O ÚNICO ponto por onde o bot fala com o Supabase.
 *
 * O problema: o schema amarra `sessao.usuario_id` em `auth.users(id)` e a RLS usa
 * `auth.uid()`. O Discord entrega um ID do Discord, não uma sessão do Supabase.
 *
 * A saída escolhida (opção 3 do doc): depois que `/cadastro` vinculou
 * `discord_id → usuario_id`, o bot **assina um JWT** com `sub = usuario_id`. O
 * PostgREST valida esse token como validaria o de um login normal, `auth.uid()`
 * devolve o usuário certo, e **a RLS continua sendo quem garante o isolamento**.
 * A alternativa — `service_role` — funcionaria, mas aí quem isola passa a ser o
 * código do bot, e qualquer `.eq('usuario_id', ...)` esquecido vira vazamento
 * entre usuários. Um `where` esquecido é um bug comum; uma política de RLS não se
 * esquece sozinha.
 *
 * ATENÇÃO, e isto é o que pode obrigar a trocar de opção: este módulo assina em
 * **HS256, com o segredo JWT legado do projeto**. Projetos Supabase recentes
 * usam chaves assimétricas (ES256) cuja privada NÃO é exportável — não dá para
 * assinar com ela. O projeto continua aceitando HS256 enquanto o segredo legado
 * não for revogado no painel. Se for, esta é a única peça a reescrever: todo o
 * resto do bot fala com `clienteDoUsuario` e não sabe como o token nasceu.
 *
 * O segredo, obviamente, nunca em `NEXT_PUBLIC_*` (diretriz 26).
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { Buffer } from "node:buffer";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/** Validade do token que o bot assina. Curta: ele é descartado no fim da request. */
const VIDA_DO_TOKEN_S = 120;

function exigir(nome: string): string {
  const v = process.env[nome];
  if (!v) throw new Error(`Variável de ambiente ausente: ${nome}`);
  return v;
}

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
 * é válido e inútil: cai em `anon`, que não tem política nenhuma.
 *
 * Nada de dependência de JWT: são três base64url e um HMAC. Uma biblioteca aqui
 * seria peso no cold start, que é justamente o que come a janela de 3 s.
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
 * Confere um JWT que este módulo assinou. Existe para o teste — o Supabase é
 * quem valida de verdade em produção — mas é a única forma de provar, sem rede,
 * que o token sai bem formado.
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

/**
 * Cliente falando pelo usuário informado. É por aqui que TODA leitura e escrita
 * do bot passa (diretriz 15, aplicada ao Supabase).
 *
 * Note o que NÃO acontece: o cliente não guarda sessão, não renova token e não
 * é reaproveitado entre requisições. Cada interação monta o seu — o mesmo aviso
 * que `lib/supabase/server.ts` carrega sobre Fluid compute vale em dobro aqui,
 * porque um cliente global carregaria a identidade de quem chamou antes.
 */
export function clienteDoUsuario(usuarioId: string): SupabaseClient {
  const token = assinarJwt(usuarioId, exigir("SUPABASE_JWT_SECRET"));

  return createClient(
    exigir("NEXT_PUBLIC_SUPABASE_URL"),
    exigir("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
    {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    },
  );
}

/**
 * Cliente sem usuário, só para `vincular_discord`.
 *
 * O `/cadastro` é o único momento em que o bot NÃO sabe quem é o usuário — é o
 * que a chamada descobre. Por isso a função no Postgres é `security definer` e
 * deliberadamente estreita (recebe código e discord_id, devolve o usuario_id, e
 * nada mais): mesmo chamada sem identidade, ela não expõe nada além disso.
 *
 * O token assinado aqui tem `sub` vazio de propósito — vale como `authenticated`
 * para o `grant execute`, e `auth.uid()` não aponta para ninguém.
 */
export function clienteSemUsuario(): SupabaseClient {
  return clienteDoUsuario("00000000-0000-0000-0000-000000000000");
}

/**
 * De qual usuário do site é este ID do Discord.
 *
 * Devolve `null` para quem nunca rodou `/cadastro` — caso comum, não erro. O
 * chamador transforma isso na mensagem que ensina o caminho.
 *
 * Roda com identidade vazia e lê `perfil`, cuja RLS é `auth.uid() = usuario_id`
 * — que não casa com ninguém. Por isso a consulta vai pela função
 * `usuario_do_discord`, `security definer` e igualmente estreita.
 */
export async function usuarioDoDiscord(discordId: string): Promise<PerfilVinculado | null> {
  const supabase = clienteSemUsuario();
  const { data, error } = await supabase
    .rpc("usuario_do_discord", { p_discord_id: discordId })
    .maybeSingle<{ usuario_id: string; fuso: string }>();

  if (error) throw new Error(`Falha ao ler o perfil: ${error.message}`);
  if (!data) return null;
  return { usuarioId: data.usuario_id, fuso: data.fuso };
}

export interface PerfilVinculado {
  usuarioId: string;
  /**
   * Fuso IANA que o SITE capturou do navegador. O bot não tem navegador de onde
   * tirar isto, e sem ele não dá para dizer a que dia de Tibia a sessão pertence
   * (docs/periodos.md): 19:34 em São Paulo é 00:34 em Berlim, ou seja, o dia
   * anterior.
   */
  fuso: string;
}
