/**
 * Usuários descartáveis para os testes que falam com o banco de verdade
 * (`testar-pastas.ts`, `testar-extras.ts` — diretriz 46).
 *
 * ## Por que usuário de verdade, e não token assinado
 *
 * Até 2026-09-27 os testes assinavam um JWT HS256 com o segredo legado do
 * projeto. Funcionava, mas prendia o projeto a manter esse segredo VERIFICANDO
 * — e quem tem ele forja token de qualquer papel, `service_role` incluso. Um
 * teste não pode ser o motivo de uma chave-mestra continuar valendo.
 *
 * Agora cada teste cria contas temporárias com a chave secreta (a API de admin,
 * mesma do `criar-usuario.ts`), entra com `signInWithPassword` pela chave
 * PUBLICÁVEL — o mesmo caminho da tela, com a RLS valendo — e apaga as contas
 * no fim. O `on delete cascade` de `auth.users` leva junto tudo o que elas
 * criaram.
 *
 * De quebra, os testes pararam de mexer nos dados de quem usa o site: antes
 * eles pegavam a primeira conta real e moviam uma sessão dela de pasta.
 *
 * ## O prefixo é reservado
 *
 * `zz-teste-` no nome de usuário. Se um teste morrer no meio, a próxima rodada
 * apaga as sobras por esse prefixo — então nenhuma conta de gente pode
 * começar assim. `normalizarUsuario` aceita hífen, e `criar-usuario.ts` recusa
 * o prefixo.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { emailDoUsuario, gerarCodigo, DOMINIO } from "../lib/conta.ts";

export const PREFIXO_DE_TESTE = "zz-teste-";

export interface UsuarioDeTeste {
  readonly id: string;
  readonly email: string;
  /** Cliente logado como este usuário, pela chave publicável: a RLS vale. */
  readonly sb: SupabaseClient;
}

const SOBRA = new RegExp(`^${PREFIXO_DE_TESTE}[a-z0-9]+@${DOMINIO.replace(".", "\\.")}$`);

/** Apaga contas de teste que uma rodada anterior deixou para trás. */
export async function apagarSobras(admin: SupabaseClient): Promise<number> {
  const { data, error } = await admin.auth.admin.listUsers({ perPage: 200 });
  if (error) throw new Error(error.message);
  const sobras = data.users.filter((u) => u.email && SOBRA.test(u.email));
  for (const u of sobras) await admin.auth.admin.deleteUser(u.id);
  return sobras.length;
}

/**
 * Cria uma conta descartável e devolve o cliente já logado nela.
 *
 * `rotulo` é uma letra (`a`, `b`) só para os nomes não colidirem na mesma
 * rodada. A senha é um código de 24 símbolos, ~119 bits, e morre com a conta.
 */
export async function criarUsuarioDeTeste(
  admin: SupabaseClient,
  url: string,
  publicavel: string,
  rotulo: string,
): Promise<UsuarioDeTeste> {
  const usuario = `${PREFIXO_DE_TESTE}${Date.now().toString(36)}${rotulo}`;
  const email = emailDoUsuario(usuario);
  const senha = gerarCodigo(6, 4);

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: senha,
    email_confirm: true,
    user_metadata: { senha_definida: true },
  });
  if (error || !data.user) throw new Error(`não criei ${usuario}: ${error?.message}`);

  const sb = createClient(url, publicavel, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error: erroLogin } = await sb.auth.signInWithPassword({ email, password: senha });
  if (erroLogin) {
    await admin.auth.admin.deleteUser(data.user.id);
    throw new Error(`não entrei como ${usuario}: ${erroLogin.message}`);
  }

  return { id: data.user.id, email, sb };
}

/** Apaga as contas. O cascade de `auth.users` leva sessões, pastas e o resto. */
export async function apagarUsuariosDeTeste(
  admin: SupabaseClient,
  usuarios: readonly UsuarioDeTeste[],
): Promise<void> {
  for (const u of usuarios) {
    const { error } = await admin.auth.admin.deleteUser(u.id);
    if (error) console.error(`não apaguei ${u.email}: ${error.message}`);
  }
}
