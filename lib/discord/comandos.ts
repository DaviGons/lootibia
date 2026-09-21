/**
 * Ver docs/bot-discord.md.
 *
 * Definição dos slash commands e dos modais que eles abrem.
 *
 * Fica separado do handler por dois motivos: `scripts/registrar-comandos.ts`
 * precisa exatamente desta lista para mandar ao Discord, e os `custom_id` dos
 * modais são o contrato entre a resposta que abre o modal e o handler que recebe
 * o submit — string solta dos dois lados é erro esperando para acontecer.
 *
 * Por que TODO comando que recebe texto abre modal, e não usa argumento:
 *
 * 1. **O analyzer é multilinha.** A barra de comando é campo de linha única. Um
 *    argumento aceita 6.000 caracteres, mas colar 25 linhas ali é inviável na
 *    prática. Campo de parágrafo em modal aceita 4.000 — e a maior sessão real
 *    medida tem ~1.460. Folga de quase 3×.
 *
 * 2. **Argumento de slash command aparece no canal.** O código do `/cadastro`
 *    vazaria para quem estivesse olhando. O que se digita em modal ninguém vê.
 */

import { TipoDeOpcao, EstiloDeTexto, LIMITES, type CampoDeEntrada } from "./protocolo.ts";
import { ROTULOS, NOME_AMIGAVEL } from "./janela.ts";

// ---------------------------------------------------------------------------
// Identificadores
// ---------------------------------------------------------------------------

export const COMANDO = {
  ADDHUNT: "addhunt",
  VIEWSTATS: "viewstats",
  CADASTRO: "cadastro",
  META: "meta",
} as const;

export const MODAL = {
  ADDHUNT: "modal:addhunt",
  CADASTRO: "modal:cadastro",
} as const;

export const CAMPO = {
  PERSONAGEM: "personagem",
  SPOT: "spot",
  ANALYZER: "analyzer",
  CODIGO: "codigo",
  PASTA: "pasta",
} as const;

/** Nome da opção de pasta nos slash commands que filtram por ela. */
export const OPCAO_PASTA = "pasta";

// ---------------------------------------------------------------------------
// Modais
// ---------------------------------------------------------------------------

/** Uma pasta, como o seletor precisa dela. */
export interface PastaParaSelecionar {
  id: number;
  nome: string;
}

/**
 * Os campos do `/addhunt`.
 *
 * É função, e não constante, porque o seletor de pasta depende de QUEM está
 * chamando: as pastas são do usuário. `pastas` vazio devolve o modal sem o
 * seletor, que é exatamente o comportamento de antes de 2026-09-21.
 *
 * Isso não é só o caso "usuário sem pasta nenhuma". O `/addhunt` responde com
 * modal, e modal **não pode ser adiado** — há 3 s contando cold start para
 * buscar as pastas no banco. Quando a busca não cabe no orçamento, o handler
 * chama esta função com lista vazia e o modal abre assim mesmo. A hunt cai em
 * "Sem pasta" e se arquiva depois, que é ruim; não abrir o modal seria pior.
 *
 * Só o analyzer é obrigatório: personagem, spot e pasta são rótulos que o jogo
 * não fornece, e exigir os três faria o usuário abandonar a importação.
 */
export function camposAddhunt(pastas: PastaParaSelecionar[] = []): CampoDeEntrada[] {
  const campos: CampoDeEntrada[] = [
    {
      id: CAMPO.PERSONAGEM,
      rotulo: "Personagem",
      estilo: EstiloDeTexto.CURTO,
      obrigatorio: false,
      tamanhoMaximo: LIMITES.MODAL_CURTO,
      exemplo: "Bubble",
    },
    {
      id: CAMPO.SPOT,
      rotulo: "Local da hunt",
      estilo: EstiloDeTexto.CURTO,
      obrigatorio: false,
      tamanhoMaximo: LIMITES.MODAL_CURTO,
      exemplo: "Asura Palace",
    },
  ];

  if (pastas.length > 0) {
    campos.push({
      id: CAMPO.PASTA,
      rotulo: "Pasta",
      descricao: "Opcional. Sem escolha, a hunt fica em “Sem pasta”.",
      obrigatorio: false,
      exemplo: "Escolha uma pasta…",
      opcoes: pastas.slice(0, LIMITES.SELECT_OPCOES).map((p) => ({
        valor: String(p.id),
        rotulo: p.nome,
      })),
    });
  }

  // O analyzer vai por ÚLTIMO de propósito: é o campo grande, e quem abre o
  // modal já chega com o texto na área de transferência. Rótulos curtos acima,
  // colagem embaixo.
  campos.push({
    id: CAMPO.ANALYZER,
    rotulo: "Hunt Analyser",
    estilo: EstiloDeTexto.PARAGRAFO,
    obrigatorio: true,
    tamanhoMaximo: LIMITES.MODAL_PARAGRAFO,
    exemplo: "Session data: From 2026-09-15, 19:34:12 to ...",
  });

  return campos;
}

export const CAMPOS_CADASTRO: CampoDeEntrada[] = [
  {
    id: CAMPO.CODIGO,
    rotulo: "Código gerado no site",
    estilo: EstiloDeTexto.CURTO,
    obrigatorio: true,
    tamanhoMaximo: 32,
    exemplo: "ABCD-2345",
  },
];

// ---------------------------------------------------------------------------
// Slash commands
// ---------------------------------------------------------------------------

export interface DefinicaoDeComando {
  name: string;
  description: string;
  type?: number;
  options?: {
    name: string;
    description: string;
    type: number;
    required?: boolean;
    autocomplete?: boolean;
    choices?: { name: string; value: string }[];
  }[];
}

/**
 * Opção de pasta, compartilhada por `/viewstats` e `/meta`.
 *
 * `autocomplete: true` em vez de `choices`: as pastas são de cada usuário e
 * mudam quando ele quiser, e `choices` é fixo no momento do registro. O
 * autocomplete é interação própria, com janela de 3 s só dela — não rouba
 * tempo do comando.
 *
 * O valor que volta é o **id** da pasta, não o nome: nome muda, e duas pessoas
 * podem ter pastas homônimas.
 */
const OPCAO_DE_PASTA = {
  name: OPCAO_PASTA,
  description: "Filtra por uma pasta. Sem isto, considera todas as hunts.",
  type: TipoDeOpcao.STRING,
  required: false,
  autocomplete: true,
};

/**
 * A lista que vai para o Discord.
 *
 * Descrições em português, como o resto do projeto (diretriz 31). Limite de 100
 * caracteres por descrição — nenhuma chega perto.
 */
export const COMANDOS: DefinicaoDeComando[] = [
  {
    name: COMANDO.CADASTRO,
    description: "Vincula seu Discord à sua conta do lootibia, com o código gerado no site",
  },
  {
    name: COMANDO.ADDHUNT,
    description: "Importa uma sessão colando o texto do Hunt Analyser",
  },
  {
    name: COMANDO.VIEWSTATS,
    description: "Mostra os acumulados do período: profit, loot, XP, tempo e mobs",
    options: [
      {
        name: "periodo",
        description: "Recorte de tempo. Padrão: esta semana (vira no server save).",
        type: TipoDeOpcao.STRING,
        required: false,
        choices: ROTULOS.map((r) => ({ name: NOME_AMIGAVEL[r], value: r })),
      },
      OPCAO_DE_PASTA,
      {
        name: "personagem",
        description: "Filtra por um personagem. Sem isto, soma todos.",
        type: TipoDeOpcao.STRING,
        required: false,
      },
      {
        // Decidido em 2026-09-17: efêmero por padrão, público por escolha de
        // quem chama. Num grupo de amigos a graça é comparar, mas quem não quer
        // mostrar o número ruim da semana não deveria ser obrigado.
        name: "publico",
        description: "Mostra a resposta para o canal inteiro. Padrão: só para você.",
        type: TipoDeOpcao.BOOLEAN,
        required: false,
      },
    ],
  },
  {
    name: COMANDO.META,
    description: "Progresso das pastas com meta: quanto falta e quantas hunts no ritmo atual",
    options: [
      OPCAO_DE_PASTA,
      {
        name: "publico",
        description: "Mostra a resposta para o canal inteiro. Padrão: só para você.",
        type: TipoDeOpcao.BOOLEAN,
        required: false,
      },
    ],
  },
];
