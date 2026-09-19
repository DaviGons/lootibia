/**
 * Cria uma conta, ou sorteia um código novo para quem esqueceu a senha.
 *
 *   node --experimental-strip-types --env-file=.env.local scripts/criar-usuario.ts pedro
 *   node --experimental-strip-types --env-file=.env.local scripts/criar-usuario.ts pedro --resetar
 *   node --experimental-strip-types --env-file=.env.local scripts/criar-usuario.ts --listar
 *
 * Não existe cadastro no site: este script é a única porta de entrada. O
 * modelo inteiro está explicado em `lib/conta.ts`; o resumo é que o código
 * sorteado aqui vira a **senha temporária** da conta, e o site obriga a trocar
 * no primeiro acesso.
 *
 * ## SUPABASE_SECRET_KEY nunca vai para a Vercel
 *
 * Criar usuário exige a chave secreta do projeto, que ignora a RLS inteira.
 * Ela fica só no `.env.local` desta máquina. O site em produção **não precisa
 * dela**: o primeiro login é um `signInWithPassword` comum e a troca de senha é
 * um `updateUser`, os dois com a chave publicável. Se um dia alguém puser a
 * secreta nas variáveis da Vercel, terá aumentado a superfície de ataque sem
 * ganhar recurso nenhum.
 */

import { createClient } from "@supabase/supabase-js";
import { emailDoUsuario, gerarCodigo, normalizarUsuario, usuarioDoEmail } from "../lib/conta.ts";

function exigir(nome: string): string {
  const v = process.env[nome];
  if (!v) {
    console.error(`Falta ${nome}. Rode com --env-file=.env.local, ou exporte a variável.`);
    process.exit(1);
  }
  return v;
}

const url = exigir("NEXT_PUBLIC_SUPABASE_URL");
const secreta = exigir("SUPABASE_SECRET_KEY");

const admin = createClient(url, secreta, {
  auth: { autoRefreshToken: false, persistSession: false },
});

/** Todas as contas do projeto. Paginado porque `listUsers` devolve 50 por vez. */
async function todosOsUsuarios() {
  const contas = [];
  for (let pagina = 1; ; pagina++) {
    const { data, error } = await admin.auth.admin.listUsers({ page: pagina, perPage: 200 });
    if (error) throw new Error(error.message);
    contas.push(...data.users);
    if (data.users.length < 200) break;
  }
  return contas;
}

async function acharPorEmail(email: string) {
  const contas = await todosOsUsuarios();
  return contas.find((c) => c.email?.toLowerCase() === email) ?? null;
}

function entregar(usuario: string, codigo: string, novo: boolean) {
  console.log("");
  console.log(`  ${novo ? "Conta criada" : "Código novo"}`);
  console.log(`  usuário: ${usuario}`);
  console.log(`  código:  ${codigo}`);
  console.log("");
  console.log("  Passe os dois para a pessoa. No primeiro acesso o código entra");
  console.log("  no lugar da senha, e o site exige escolher uma senha na hora.");
  console.log("");
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes("--listar")) {
    const contas = await todosOsUsuarios();
    if (contas.length === 0) return console.log("Nenhuma conta.");
    console.log(`${contas.length} conta(s):\n`);
    for (const c of contas) {
      const nome = usuarioDoEmail(c.email) ?? `(fora do padrão: ${c.email})`;
      const trocou = c.user_metadata?.senha_definida === true;
      console.log(`  ${nome.padEnd(22)} ${trocou ? "senha própria" : "AINDA NO CÓDIGO"}`);
    }
    return;
  }

  const bruto = args.find((a) => !a.startsWith("--"));
  if (!bruto) {
    console.error("Uso: criar-usuario.ts <nome> [--resetar] | --listar");
    process.exit(1);
  }

  const usuario = normalizarUsuario(bruto);
  if (!usuario) {
    console.error(
      `"${bruto}" não serve como nome de usuário.\n` +
        "Regra: começa com letra, depois letra/número/_/-, de 3 a 20 caracteres.",
    );
    process.exit(1);
  }
  if (usuario !== bruto) console.log(`(normalizado para "${usuario}")`);

  const email = emailDoUsuario(usuario);
  const existente = await acharPorEmail(email);
  const resetar = args.includes("--resetar");
  const codigo = gerarCodigo();

  if (existente && !resetar) {
    console.error(
      `"${usuario}" já existe. Para sortear um código novo (esqueceu a senha):\n` +
        `  node --experimental-strip-types --env-file=.env.local scripts/criar-usuario.ts ${usuario} --resetar`,
    );
    process.exit(1);
  }

  if (existente) {
    // Repor o código derruba a senha atual e devolve a conta ao estado de
    // primeiro acesso — é exatamente o que "esqueci a senha" precisa fazer.
    const { error } = await admin.auth.admin.updateUserById(existente.id, {
      password: codigo,
      user_metadata: { ...existente.user_metadata, senha_definida: false },
    });
    if (error) throw new Error(error.message);
    entregar(usuario, codigo, false);
    return;
  }

  if (resetar) {
    console.error(`"${usuario}" não existe — nada para resetar.`);
    process.exit(1);
  }

  const { error } = await admin.auth.admin.createUser({
    email,
    password: codigo,
    // Já confirmado: o domínio é `.invalid` e nenhuma mensagem sai daqui. Sem
    // isto o GoTrue tentaria enviar confirmação para um endereço que, por
    // definição da RFC 6761, não existe.
    email_confirm: true,
    user_metadata: { senha_definida: false },
  });
  if (error) throw new Error(error.message);
  entregar(usuario, codigo, true);
}

main().catch((e) => {
  console.error("FALHOU:", (e as Error).message);
  process.exit(1);
});
