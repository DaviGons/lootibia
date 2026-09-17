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
} as const;

// ---------------------------------------------------------------------------
// Modais
// ---------------------------------------------------------------------------

/**
 * Os três campos do `/addhunt`.
 *
 * Só o analyzer é obrigatório: personagem e spot são rótulos que o jogo não
 * fornece, e exigir os dois faria o usuário abandonar a importação. Sem spot a
 * sessão simplesmente não entra em "hunts mais caçadas" — e o rodapé do
 * `/viewstats` avisa quantas ficaram assim.
 */
export const CAMPOS_ADDHUNT: CampoDeEntrada[] = [
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
  {
    id: CAMPO.ANALYZER,
    rotulo: "Hunt Analyser",
    estilo: EstiloDeTexto.PARAGRAFO,
    obrigatorio: true,
    tamanhoMaximo: LIMITES.MODAL_PARAGRAFO,
    exemplo: "Session data: From 2026-09-15, 19:34:12 to ...",
  },
];

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
    choices?: { name: string; value: string }[];
  }[];
}

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
];
