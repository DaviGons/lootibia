/**
 * Conta por nome de usuário, sem e-mail.
 *
 * O Davi cria as contas; ninguém se cadastra sozinho. Quem entra pela primeira
 * vez usa um **código de ativação** e escolhe a própria senha ali.
 *
 * ## Por que continua em cima do Supabase Auth
 *
 * Toda a RLS do projeto é `auth.uid() = usuario_id`, o bot do Discord assina um
 * JWT com `sub = usuario_id` (diretriz 34) e a sessão do site é o cookie do
 * `@supabase/ssr`. Trocar o Supabase Auth por autenticação própria significaria
 * reescrever as políticas das seis tabelas, o bot e o middleware — para ganhar
 * o quê? O que muda de verdade é só a **credencial**: nome de usuário no lugar
 * de e-mail. Então é só isso que muda.
 *
 * ## Como o nome de usuário vira e-mail
 *
 * O GoTrue só sabe autenticar por e-mail ou telefone. Então `pedro` vira
 * `pedro@lootibia.invalid`, de forma determinística: não existe tabela de
 * de-para, não existe consulta antes do login, e o e-mail nunca aparece na
 * interface.
 *
 * `.invalid` é reservado pela RFC 6761 justamente para isto — o padrão garante
 * que o domínio nunca resolve. Nenhuma mensagem pode ser enviada para lá nem
 * por engano, o que é a propriedade que se quer: não há recuperação de senha
 * por e-mail neste projeto, e não deve haver.
 *
 * ## O código de ativação É a senha temporária
 *
 * Nada de estado especial no banco: o script de criação põe o código como senha
 * da conta. O primeiro login é um `signInWithPassword` comum. Quem decide que
 * ainda falta trocar a senha é a flag `senha_definida` em `user_metadata`.
 *
 * Essa flag é **porteiro de fluxo, não fronteira de segurança** — `user_metadata`
 * é gravável pelo próprio dono, então um usuário determinado consegue virá-la
 * sem trocar a senha. O que ele ganha com isso é continuar com uma senha que o
 * Davi mandou por Discord; não ganha acesso a dado de mais ninguém, porque quem
 * isola continua sendo a RLS. A segurança de verdade está no código ser um
 * segredo de ~49 bits, não em quem pode escrever a flag.
 */

/**
 * Domínio sintético. Se algum dia o GoTrue recusar `.invalid`, é esta linha que
 * muda — e nada mais, porque ninguém monta o e-mail à mão.
 */
export const DOMINIO = "lootibia.invalid";

/** Comprimento mínimo da senha que o usuário escolhe. */
export const MIN_SENHA = 8;

/**
 * Começa com letra, segue com letra, número, `_` ou `-`, de 3 a 20.
 *
 * Sem ponto e sem `@`: os dois são válidos em e-mail e deixariam dois nomes
 * diferentes virarem endereços parecidos demais para um olho cansado.
 */
const FORMATO = /^[a-z][a-z0-9_-]{2,19}$/;

/**
 * Apara e passa para minúsculas, devolvendo `null` se não servir.
 *
 * Minúsculas sempre: `Pedro` e `pedro` têm de ser a mesma conta, senão dá para
 * criar duas contas quase idênticas e ninguém percebe.
 */
export function normalizarUsuario(bruto: string): string | null {
  const u = bruto.trim().toLowerCase();
  return FORMATO.test(u) ? u : null;
}

/** `pedro` -> `pedro@lootibia.invalid`. Assume nome já normalizado. */
export function emailDoUsuario(usuario: string): string {
  return `${usuario}@${DOMINIO}`;
}

/**
 * O caminho de volta, para a interface mostrar `pedro` e não o e-mail.
 *
 * Deriva do e-mail em vez de ler um campo guardado: assim não existe segundo
 * lugar para o nome divergir, e não dá para o usuário renomear a si mesmo
 * mexendo no próprio `user_metadata`.
 */
export function usuarioDoEmail(email: string | undefined): string | null {
  if (!email) return null;
  const sufixo = `@${DOMINIO}`;
  if (!email.endsWith(sufixo)) return null;
  return email.slice(0, -sufixo.length) || null;
}

/**
 * Alfabeto sem os pares que se confundem em fonte de tela e na leitura em voz
 * alta: sem `0`/`O`, sem `1`/`I`/`L`. Sobram 31 símbolos, e o código vai ser
 * ditado por Discord ou copiado à mão.
 */
const ALFABETO = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

/**
 * Maior múltiplo de 31 que cabe num byte. Byte sorteado acima disto é
 * descartado em vez de sofrer `% 31`: 256 não é múltiplo de 31, então o resto
 * direto faria os 8 primeiros símbolos saírem mais que os outros 23.
 */
const LIMITE = 256 - (256 % ALFABETO.length);

/**
 * Código de ativação, no formato `XXXXX-XXXXX`.
 *
 * 10 símbolos de 31 dão 31¹⁰ ≈ 8,2 × 10¹⁴, ou ~49 bits. É o que segura a conta
 * até o dono trocar a senha, então vem de `crypto.getRandomValues` e não de
 * `Math.random`, que é previsível por construção.
 */
export function gerarCodigo(porGrupo = 5, grupos = 2): string {
  const total = porGrupo * grupos;
  const simbolos: string[] = [];

  while (simbolos.length < total) {
    const bytes = new Uint8Array(total);
    crypto.getRandomValues(bytes);
    for (const b of bytes) {
      if (b >= LIMITE) continue; // amostragem por rejeição, ver LIMITE
      simbolos.push(ALFABETO[b % ALFABETO.length]);
      if (simbolos.length === total) break;
    }
  }

  return Array.from({ length: grupos }, (_, i) =>
    simbolos.slice(i * porGrupo, (i + 1) * porGrupo).join(""),
  ).join("-");
}

/**
 * Por que a senha é recusada, ou `null` se estiver boa.
 *
 * Devolve a frase pronta em vez de um booleano porque quem chama são duas telas
 * e um script, e três cópias da mesma frase divergem na primeira alteração.
 */
export function problemaDaSenha(senha: string, usuario?: string | null): string | null {
  if (senha.length < MIN_SENHA) return `A senha precisa de pelo menos ${MIN_SENHA} caracteres.`;
  if (usuario && senha.toLowerCase() === usuario.toLowerCase())
    return "A senha não pode ser igual ao nome de usuário.";
  return null;
}

/**
 * A conta já trocou o código de ativação por uma senha própria?
 *
 * Lê de um objeto solto porque o formato muda conforme a origem: o middleware
 * recebe as claims do JWT, o cliente recebe o `User` do supabase-js. Ausente
 * conta como `false` — conta velha sem a flag tem de passar pela troca.
 */
export function senhaFoiDefinida(metadados: unknown): boolean {
  if (!metadados || typeof metadados !== "object") return false;
  return (metadados as { senha_definida?: unknown }).senha_definida === true;
}
