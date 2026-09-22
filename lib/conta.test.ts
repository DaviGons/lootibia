import {
  DOMINIO,
  MIN_SENHA,
  emailDoUsuario,
  gerarCodigo,
  normalizarUsuario,
  problemaDaSenha,
  senhaFoiDefinida,
  usuarioDoEmail,
} from "./conta.ts";

let falhas = 0;
function ok(nome: string, real: unknown, esperado: unknown) {
  const a = JSON.stringify(real);
  const b = JSON.stringify(esperado);
  const passou = a === b;
  if (!passou) falhas++;
  console.log(`${passou ? "ok  " : "FALHA"} ${nome}  ->  ${a}${passou ? "" : `  (esperado ${b})`}`);
}

console.log("== normalizacao do nome de usuario");
ok("minusculas", normalizarUsuario("Pedro"), "pedro");
ok("apara espaco", normalizarUsuario("  pedro  "), "pedro");
// Pedro e pedro TEM de ser a mesma conta: senao da para criar duas contas
// quase identicas e o dono nunca percebe qual e a dele.
ok("Pedro e pedro dao a mesma conta", normalizarUsuario("Pedro") === normalizarUsuario("pedro"), true);
ok("aceita numero, _ e -", normalizarUsuario("davi_g-2"), "davi_g-2");
ok("recusa vazio", normalizarUsuario(""), null);
ok("recusa curto demais", normalizarUsuario("ab"), null);
ok("recusa longo demais", normalizarUsuario("a".repeat(21)), null);
ok("aceita no limite de 20", normalizarUsuario("a".repeat(20)), "a".repeat(20));
ok("recusa comeco com numero", normalizarUsuario("2pac"), null);
ok("recusa espaco no meio", normalizarUsuario("da vi"), null);
ok("recusa acento", normalizarUsuario("joão"), null);

console.log("== nao da para escapar do dominio sintetico");
// O nome vira e-mail sem passar por tabela nenhuma. Se um `@` ou um ponto
// passasse pelo filtro, o usuario escolheria o endereco — e com ele a conta.
ok("recusa arroba", normalizarUsuario("pedro@outro.com"), null);
ok("recusa ponto", normalizarUsuario("pedro.silva"), null);
ok("recusa tentativa de injetar dominio", normalizarUsuario("admin@lootibia.invalid"), null);

console.log("== ida e volta entre usuario e e-mail");
ok("monta o e-mail", emailDoUsuario("pedro"), `pedro@${DOMINIO}`);
ok("volta do e-mail", usuarioDoEmail(`pedro@${DOMINIO}`), "pedro");
ok("ida e volta preserva", usuarioDoEmail(emailDoUsuario("davi_g-2")), "davi_g-2");
// E-mail de verdade nao vira nome de usuario: se um dia sobrar conta antiga no
// banco, a interface mostra nada em vez de vazar o endereco de alguem.
ok("e-mail de fora devolve null", usuarioDoEmail("alguem@gmail.com"), null);
ok("undefined devolve null", usuarioDoEmail(undefined), null);
ok("so o dominio devolve null", usuarioDoEmail(`@${DOMINIO}`), null);

console.log("== codigo de ativacao");
const codigo = gerarCodigo();
ok("formato XXXXX-XXXXX", /^[2-9A-HJ-NP-Z]{5}-[2-9A-HJ-NP-Z]{5}$/.test(codigo), true);
// Sem 0/O e sem 1/I/L: o codigo e ditado por mensagem e digitado a mao.
ok("sem caractere ambiguo", /[01OIL]/.test(codigo), false);
const amostra = new Set(Array.from({ length: 400 }, () => gerarCodigo()));
ok("400 sorteios sem repetir", amostra.size, 400);
// Amostragem por rejeicao: 256 nao e multiplo de 31, entao `% 31` direto faria
// os 8 primeiros simbolos saírem ~29% mais que os outros 23. Com 400 codigos
// de 10 simbolos sao 4000 sorteios; o vies apareceria como um alfabeto
// incompleto ou uma cauda visivelmente rala.
const vistos = new Set([...amostra].join("").replace(/-/g, ""));
ok("os 31 simbolos aparecem", vistos.size, 31);

console.log("== senha escolhida pelo usuario");
ok("curta demais e recusada", problemaDaSenha("1234567") !== null, true);
ok(`${MIN_SENHA} caracteres passa`, problemaDaSenha("a".repeat(MIN_SENHA)), null);
ok("igual ao usuario e recusada", problemaDaSenha("pedrosilva", "pedrosilva") !== null, true);
ok("igual ao usuario ignora caixa", problemaDaSenha("PedroSilva", "pedrosilva") !== null, true);
ok("diferente do usuario passa", problemaDaSenha("umaSenhaBoa1", "pedro"), null);

console.log("== flag de senha ja definida");
// Ausente conta como false: conta criada antes da flag existir tem de passar
// pela troca, e nao entrar direto com o codigo de ativacao valendo de senha.
ok("ausente e false", senhaFoiDefinida({}), false);
ok("undefined e false", senhaFoiDefinida(undefined), false);
ok("null e false", senhaFoiDefinida(null), false);
ok("true e true", senhaFoiDefinida({ senha_definida: true }), true);
// Estritamente `true`: string "true" vinda de um JSON malfeito nao vale.
ok('a string "true" nao vale', senhaFoiDefinida({ senha_definida: "true" }), false);
ok("1 nao vale", senhaFoiDefinida({ senha_definida: 1 }), false);

console.log(falhas === 0 ? "\nTODOS OS TESTES PASSARAM" : `\n${falhas} FALHA(S)`);
if (falhas > 0) process.exit(1);
