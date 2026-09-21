/**
 * Ver docs/bot-discord.md.
 *
 * Endpoint de Interactions do Discord. É o bot inteiro: não há processo ligado,
 * não há WebSocket. O Discord faz `POST` aqui e esta função responde.
 *
 * Três coisas governam este arquivo, e nenhuma é negociável:
 *
 * **1. A janela de 3 segundos.** A resposta inicial tem de sair em 3 s ou o
 * token é invalidado. Parse e gravação levam ~1 s, mas o cold start de uma
 * função serverless come esse orçamento sozinho — então tudo que toca o banco
 * adia primeiro (`adiar()`) e responde depois, dentro dos 15 min que o defer
 * concede.
 *
 * **2. `after()` é obrigatório, não otimização.** Em serverless a invocação
 * morre quando o handler retorna. Sem `after()`, o trabalho agendado depois do
 * defer simplesmente não roda: o usuário veria "pensando..." para sempre. Na
 * Vercel, `after()` mapeia para `waitUntil`, que segura a instância viva.
 *
 * **3. Modal precisa ser a resposta INICIAL.** Não existe adiar e abrir modal
 * depois. Por isso `/addhunt` e `/cadastro` respondem modal na hora, sem tocar
 * no banco, e o trabalho de verdade acontece no submit — que é outra interação.
 *
 *     /comando  →  MODAL (imediato)
 *                  ↓ usuário preenche
 *                  nova interação  →  defer  →  trabalha  →  edita a resposta
 *
 * O corpo cru é lido com `req.text()` e só depois parseado: a assinatura cobre o
 * texto exato que chegou, e reserializar um objeto reordena chaves e invalida a
 * verificação.
 */

import { after } from "next/server";
import { assinaturaConfere, chavePublicaDoDiscord } from "@/lib/discord/assinatura";
import {
  TipoDeInteracao,
  TipoDeResposta,
  autorDaInteracao,
  campoDoModal,
  selecaoDoModal,
  opcaoBooleana,
  opcaoTexto,
  opcaoFocada,
  autocompletar,
  adiar,
  editarResposta,
  mensagem,
  modal,
  COR,
  type Interacao,
  type Embed,
} from "@/lib/discord/protocolo";
import {
  COMANDO,
  MODAL,
  CAMPO,
  OPCAO_PASTA,
  camposAddhunt,
  CAMPOS_CADASTRO,
} from "@/lib/discord/comandos";
import { embedDeResumo, embedDeMetas, embedDeErro, compacto, horas } from "@/lib/discord/embed";
import { janelaDe, lerRotulo, descreverJanela } from "@/lib/discord/janela";
import { clienteDoUsuario, clienteSemUsuario, usuarioDoDiscord } from "@/lib/supabase/bot";
import { importarSessao } from "@/lib/importacao";
import {
  resumoDoPeriodo,
  pastasDoUsuario,
  precoDaTc,
  totaisPorPasta,
  type PastaDoUsuario,
} from "@/lib/consulta";

// Este handler PRECISA do runtime Node: `node:crypto` verifica a assinatura
// Ed25519 e assina o JWT do Supabase, e nenhum dos dois existe no Edge.
//
// Não há `export const runtime = 'nodejs'` aqui porque com Cache Components
// ligado (next.config.ts) o Next recusa o build com esse export — é a mesma
// família de restrições que aposentou `export const dynamic` (diretriz 32).
// Node já é o padrão de route handler, então o efeito é o desejado; o que se
// perde é o aviso em tempo de build caso alguém mude o padrão um dia.

/** Resposta JSON crua — o Discord só aceita `application/json`. */
function json(corpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Mensagem para quem ainda não vinculou a conta.
 *
 * Aparece em todo comando que precisa de identidade, então mora aqui em vez de
 * ser repetida — e ensina o caminho em vez de só recusar.
 */
function precisaCadastro(): Embed {
  return embedDeErro(
    "Conta não vinculada",
    "Abra **/hunts** no site, gere um código em “Vincular Discord” e rode `/cadastro` aqui.\n" +
      "O vínculo também é o que dá ao bot o seu fuso horário — sem ele não dá para saber a que dia de Tibia cada sessão pertence.",
  );
}

export async function POST(req: Request) {
  const chaveBruta = process.env.DISCORD_PUBLIC_KEY;
  if (!chaveBruta) {
    console.error("[discord] DISCORD_PUBLIC_KEY ausente — nenhuma interação pode ser verificada.");
    return json({ erro: "bot não configurado" }, 500);
  }

  const corpoCru = await req.text();

  // O Discord manda interações inválidas de propósito ao registrar a URL, e
  // recusa o endpoint se ele não devolver 401. Isto não é só defesa: é requisito.
  const valida = assinaturaConfere(
    chavePublicaDoDiscord(chaveBruta),
    req.headers.get("x-signature-ed25519"),
    req.headers.get("x-signature-timestamp"),
    corpoCru,
  );
  if (!valida) return json({ erro: "assinatura inválida" }, 401);

  let interacao: Interacao;
  try {
    interacao = JSON.parse(corpoCru) as Interacao;
  } catch {
    return json({ erro: "corpo ilegível" }, 400);
  }

  // Handshake de verificação do Discord.
  if (interacao.type === TipoDeInteracao.PING) {
    return json({ type: TipoDeResposta.PONG });
  }

  if (interacao.type === TipoDeInteracao.APPLICATION_COMMAND) {
    return responderComando(interacao);
  }

  // Autocomplete é interação PRÓPRIA, com janela de 3 s só dela — por isso a
  // opção de pasta pôde virar um seletor de verdade sem roubar tempo do
  // comando. Não existe adiar aqui: ou a lista sai, ou o campo fica sem
  // sugestão e a pessoa digita à mão.
  if (interacao.type === TipoDeInteracao.APPLICATION_COMMAND_AUTOCOMPLETE) {
    return responderAutocomplete(interacao);
  }

  if (interacao.type === TipoDeInteracao.MODAL_SUBMIT) {
    return responderModal(interacao);
  }

  return json({ erro: "tipo de interação não tratado" }, 400);
}

// ---------------------------------------------------------------------------
// Slash commands
// ---------------------------------------------------------------------------

async function responderComando(i: Interacao): Promise<Response> {
  switch (i.data?.name) {
    case COMANDO.ADDHUNT:
      return comandoAddhunt(i);

    case COMANDO.CADASTRO:
      // Sem banco e sem defer: modal tem de ser a resposta inicial.
      return json(modal(MODAL.CADASTRO, "Vincular conta do lootibia", CAMPOS_CADASTRO));

    case COMANDO.VIEWSTATS:
      return comandoViewstats(i);

    case COMANDO.META:
      return comandoMeta(i);

    default:
      return json(mensagem("Comando desconhecido."));
  }
}

/**
 * Quanto tempo o `/addhunt` pode gastar buscando as pastas antes de desistir.
 *
 * Medido em 2026-09-21: cold start do endpoint chega a 1,5 s e a primeira ida
 * ao Supabase, a 0,85 s — 2,35 s dos 3 s disponíveis, no pior caso, e a medição
 * saiu de fora da região da função. Folga pequena demais para confiar.
 *
 * Com 1,2 s de teto, o pior caso vira ~2,7 s **e nunca estoura**: passado o
 * prazo o modal abre sem o seletor, a hunt cai em "Sem pasta" e se arquiva
 * depois. É pior que escolher na hora, e muito melhor que "a aplicação não
 * respondeu" — que é o que o usuário veria se passássemos de 3 s.
 */
const ORCAMENTO_DAS_PASTAS_MS = 1200;

/**
 * `/addhunt` — abre o modal de importação.
 *
 * O único comando que toca o banco SEM poder adiar, porque a resposta é um
 * modal. Daí o orçamento acima: a busca corre contra um timer, e o que perder a
 * corrida é descartado, não esperado.
 *
 * Qualquer falha aqui é degradação, não erro: sem pastas o modal ainda importa
 * a hunt, que é o essencial.
 */
async function comandoAddhunt(i: Interacao): Promise<Response> {
  const autor = autorDaInteracao(i);
  if (!autor) return json(mensagem("Não consegui identificar quem chamou o comando."));

  const pastas = await dentroDoOrcamento(
    (async () => {
      const perfil = await usuarioDoDiscord(autor.id);
      if (!perfil) return [];
      return pastasDoUsuario(clienteDoUsuario(perfil.usuarioId));
    })(),
    ORCAMENTO_DAS_PASTAS_MS,
    [] as PastaDoUsuario[],
  );

  return json(modal(MODAL.ADDHUNT, "Importar sessão", camposAddhunt(pastas)));
}

/**
 * Espera a promessa até o prazo; estourou, devolve o padrão.
 *
 * A promessa perdedora NÃO é cancelada — não há como cancelar um `fetch` já
 * em voo sem um `AbortController` por chamada, e o cliente do Supabase não
 * expõe um. Ela termina sozinha e o resultado é ignorado. O `catch` vazio
 * existe para que uma rejeição tardia não vire `unhandledRejection` e derrube
 * a instância depois de já termos respondido.
 */
function dentroDoOrcamento<T>(promessa: Promise<T>, ms: number, padrao: T): Promise<T> {
  let temporizador: ReturnType<typeof setTimeout>;
  const prazo = new Promise<T>((resolve) => {
    temporizador = setTimeout(() => resolve(padrao), ms);
  });
  return Promise.race([
    promessa.catch((e) => {
      console.error("[discord] busca de pastas falhou:", e);
      return padrao;
    }),
    prazo,
  ]).finally(() => clearTimeout(temporizador));
}

// ---------------------------------------------------------------------------
// Autocomplete
// ---------------------------------------------------------------------------

/**
 * Sugere pastas enquanto o usuário digita, em `/viewstats` e `/meta`.
 *
 * O valor sugerido é o **id** da pasta, não o nome: nome muda, e o comando
 * precisa de uma referência estável. O que a pessoa vê continua sendo o nome.
 *
 * Falha vira lista vazia, nunca erro: o campo continua aceitando texto, e um
 * autocomplete mudo é menos ruim que um comando quebrado.
 */
async function responderAutocomplete(i: Interacao): Promise<Response> {
  const focada = opcaoFocada(i);
  const autor = autorDaInteracao(i);
  if (!focada || focada.nome !== OPCAO_PASTA || !autor) return json(autocompletar([]));

  try {
    const pastas = await dentroDoOrcamento(
      (async () => {
        const perfil = await usuarioDoDiscord(autor.id);
        if (!perfil) return [];
        return pastasDoUsuario(clienteDoUsuario(perfil.usuarioId));
      })(),
      ORCAMENTO_DAS_PASTAS_MS,
      [] as PastaDoUsuario[],
    );

    const busca = focada.texto.toLowerCase();
    const filtradas = busca
      ? pastas.filter((p) => p.nome.toLowerCase().includes(busca))
      : pastas;

    return json(
      autocompletar(filtradas.map((p) => ({ nome: p.nome, valor: String(p.id) }))),
    );
  } catch (e) {
    console.error("[discord] autocomplete falhou:", e);
    return json(autocompletar([]));
  }
}

/**
 * `/viewstats` — os números da tela, em embed.
 *
 * Único comando que adia direto do slash command, porque não abre modal: os três
 * argumentos cabem em opções, e nenhum deles é segredo.
 *
 * A visibilidade é decidida AQUI e não muda depois: o follow-up não consegue
 * alterar a flag de uma resposta já adiada.
 */
function comandoViewstats(i: Interacao): Response {
  const publico = opcaoBooleana(i, "publico", false);
  const rotulo = lerRotulo(opcaoTexto(i, "periodo"));
  const personagem = opcaoTexto(i, "personagem");
  // O autocomplete devolve o id, mas nada impede a pessoa de digitar qualquer
  // coisa e dar enter — o Discord aceita texto livre num campo autocompletável.
  const pastaId = idDePasta(opcaoTexto(i, OPCAO_PASTA));
  const autor = autorDaInteracao(i);

  if (!autor) return json(mensagem("Não consegui identificar quem chamou o comando."));

  after(async () => {
    const janela = janelaDe(rotulo);
    const nomeDeExibicao = autor.global_name ?? autor.username;

    try {
      const perfil = await usuarioDoDiscord(autor.id);
      if (!perfil) {
        await editarResposta(i.application_id, i.token, { embeds: [precisaCadastro()] });
        return;
      }

      const supabase = clienteDoUsuario(perfil.usuarioId);

      // O nome da pasta vem de uma consulta à parte porque o filtro é por id:
      // sem ele o embed diria "Hunts de Davi" para um recorte de uma pasta só,
      // e o número pareceria o total.
      const pastas = pastaId === null ? [] : await pastasDoUsuario(supabase);
      const pasta = pastas.find((p) => p.id === pastaId) ?? null;

      if (pastaId !== null && !pasta) {
        await editarResposta(i.application_id, i.token, {
          embeds: [
            embedDeErro(
              "Pasta não encontrada",
              "Escolha uma das sugestões do campo `pasta` em vez de digitar o nome.",
            ),
          ],
        });
        return;
      }

      const { resumo, truncado } = await resumoDoPeriodo(supabase, {
        inicio: janela.inicio,
        fim: janela.fim,
        personagem,
        pastaId,
      });

      const embed = embedDeResumo(resumo, {
        janela,
        personagem,
        pasta: pasta?.nome ?? null,
        autor: nomeDeExibicao,
      });

      if (truncado && embed.footer) {
        embed.footer.text += " · lista truncada";
      }

      await editarResposta(i.application_id, i.token, { embeds: [embed] });
    } catch (e) {
      console.error("[discord] /viewstats falhou:", e);
      await editarResposta(i.application_id, i.token, {
        embeds: [
          embedDeErro(
            "Não consegui montar o resumo",
            `Período: ${descreverJanela(janela)}.\nDetalhe técnico: ${(e as Error).message}`,
          ),
        ],
      });
    }
  });

  return json(adiar(!publico));
}

/**
 * Converte para id de pasta o que veio do autocomplete ou do seletor.
 *
 * Os dois entregam o id como string, mas nenhum dos dois é confiável: num campo
 * autocompletável o Discord aceita texto livre, então "Roshamuul" chega aqui
 * inteiro se a pessoa digitar e apertar enter sem escolher a sugestão. Devolver
 * `NaN` viraria `pasta_id = NaN` numa consulta; devolver `null` cai no caminho
 * de "sem filtro", que o chamador trata.
 */
function idDePasta(bruto: string | null): number | null {
  if (!bruto) return null;
  const n = Number(bruto);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * `/meta` — progresso das pastas com meta.
 *
 * É a informação que só existe desde as pastas, e a mais "comparável" do
 * produto: quanto falta para o alvo, e quantas hunts nisso.
 *
 * Adia como o `/viewstats`, pelo mesmo motivo — e a visibilidade é decidida
 * aqui, antes do defer, porque o follow-up não muda a flag depois.
 */
function comandoMeta(i: Interacao): Response {
  const publico = opcaoBooleana(i, "publico", false);
  const pastaId = idDePasta(opcaoTexto(i, OPCAO_PASTA));
  const autor = autorDaInteracao(i);

  if (!autor) return json(mensagem("Não consegui identificar quem chamou o comando."));

  after(async () => {
    try {
      const perfil = await usuarioDoDiscord(autor.id);
      if (!perfil) {
        await editarResposta(i.application_id, i.token, { embeds: [precisaCadastro()] });
        return;
      }

      const supabase = clienteDoUsuario(perfil.usuarioId);

      // As três em paralelo: são independentes, e serializá-las triplicaria a
      // espera dentro de uma janela de follow-up que já é generosa mas não
      // infinita (15 min, e a instância fica viva nesse tempo).
      const [pastas, totais, preco] = await Promise.all([
        pastasDoUsuario(supabase),
        totaisPorPasta(supabase),
        precoDaTc(supabase),
      ]);

      const comMeta = pastas
        .filter((p) => (pastaId === null || p.id === pastaId) && p.metaValor && p.metaUnidade)
        .map((p) => {
          const t = totais.get(p.id);
          return {
            nome: p.nome,
            meta: { valor: p.metaValor!, unidade: p.metaUnidade! },
            profit: t?.profit ?? 0,
            hunts: t?.hunts ?? 0,
          };
        });

      await editarResposta(i.application_id, i.token, {
        embeds: [embedDeMetas(comMeta, preco, autor.global_name ?? autor.username)],
      });
    } catch (e) {
      console.error("[discord] /meta falhou:", e);
      await editarResposta(i.application_id, i.token, {
        embeds: [embedDeErro("Não consegui ler as metas", (e as Error).message)],
      });
    }
  });

  return json(adiar(!publico));
}

// ---------------------------------------------------------------------------
// Submits de modal
// ---------------------------------------------------------------------------

function responderModal(i: Interacao): Response {
  switch (i.data?.custom_id) {
    case MODAL.ADDHUNT:
      return submitAddhunt(i);
    case MODAL.CADASTRO:
      return submitCadastro(i);
    default:
      return json(mensagem("Formulário desconhecido."));
  }
}

/**
 * Submit do `/addhunt`: parseia, grava e confirma.
 *
 * Sempre efêmero. Quem cola o analyzer não pediu para publicar a hunt no canal —
 * quem quiser mostrar usa `/viewstats publico:true`.
 */
function submitAddhunt(i: Interacao): Response {
  const autor = autorDaInteracao(i);
  if (!autor) return json(mensagem("Não consegui identificar quem enviou o formulário."));

  const texto = campoDoModal(i, CAMPO.ANALYZER) ?? "";
  const spot = campoDoModal(i, CAMPO.SPOT);
  const personagem = campoDoModal(i, CAMPO.PERSONAGEM);
  // `selecaoDoModal`, não `campoDoModal`: o String Select devolve `values`, um
  // array, e não `value`. Ler o campo errado daria `null` sem erro nenhum.
  const pastaId = idDePasta(selecaoDoModal(i, CAMPO.PASTA));

  after(async () => {
    try {
      const perfil = await usuarioDoDiscord(autor.id);
      if (!perfil) {
        await editarResposta(i.application_id, i.token, { embeds: [precisaCadastro()] });
        return;
      }

      const supabase = clienteDoUsuario(perfil.usuarioId);
      const r = await importarSessao(supabase, {
        texto,
        spot,
        personagem,
        pastaId,
        // Herdado do que o site capturou do navegador. O bot não tem de onde
        // tirar isto sozinho (docs/periodos.md).
        fuso: perfil.fuso,
        usuarioId: perfil.usuarioId,
      });

      if (!r.ok) {
        const titulo =
          r.motivo === "duplicata"
            ? "Sessão já importada"
            : r.motivo === "parse"
              ? "Não consegui ler o texto"
              : "Erro ao gravar";
        const detalhe =
          r.motivo === "parse"
            ? `${r.mensagem}\n\nCole o texto **inteiro** que o Hunt Analyser copia, do \`Session data:\` até a última linha de loot.`
            : r.mensagem;
        await editarResposta(i.application_id, i.token, {
          embeds: [embedDeErro(titulo, detalhe)],
        });
        return;
      }

      // Nome da pasta só para a confirmação: quem escolheu no seletor precisa
      // ver ONDE a hunt foi parar, senão a escolha vira ato de fé. Uma consulta
      // a mais aqui não custa — a esta altura já estamos adiados, com 15 min.
      let nomeDaPasta: string | null = null;
      if (r.pastaId !== null) {
        const pastas = await pastasDoUsuario(supabase).catch(() => []);
        nomeDaPasta = pastas.find((p) => p.id === r.pastaId)?.nome ?? null;
      }

      const rotulos = [personagem, spot, nomeDaPasta && `📁 ${nomeDaPasta}`]
        .filter(Boolean)
        .join(" · ");
      await editarResposta(i.application_id, i.token, {
        embeds: [
          {
            title: "Sessão importada",
            description: rotulos || undefined,
            color: COR,
            fields: [
              { name: "Profit", value: compacto(r.profit), inline: true },
              { name: "Tempo", value: horas(r.duracaoSegundos), inline: true },
              {
                name: "Detalhe",
                value: `${r.monstros} monstros · ${r.itens} itens`,
                inline: true,
              },
            ],
            footer: {
              text: !spot
                ? "Sem local: esta hunt não entra em “hunts mais caçadas”."
                : r.pastaId === null
                  ? "Sem pasta: arquive pelo site, ou escolha no seletor na próxima."
                  : "Use /meta para ver o quanto falta.",
            },
          },
        ],
      });
    } catch (e) {
      console.error("[discord] /addhunt falhou:", e);
      await editarResposta(i.application_id, i.token, {
        embeds: [embedDeErro("Erro inesperado ao importar", (e as Error).message)],
      });
    }
  });

  return json(adiar(true));
}

/**
 * Submit do `/cadastro`: valida o código e vincula.
 *
 * Sempre efêmero, sem exceção — a resposta menciona a conta do site.
 *
 * A validação e a queima do código acontecem numa função do Postgres, em uma
 * transação: dois `/cadastro` simultâneos com o mesmo código não podem vincular
 * duas contas do Discord.
 */
function submitCadastro(i: Interacao): Response {
  const autor = autorDaInteracao(i);
  if (!autor) return json(mensagem("Não consegui identificar quem enviou o formulário."));

  // Maiúsculas e sem separador: o código é gerado assim, mas quem digita à mão
  // erra o caso e o hífen. Normalizar aqui evita um "código inválido" injusto.
  const codigo = (campoDoModal(i, CAMPO.CODIGO) ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

  after(async () => {
    try {
      if (!codigo) {
        await editarResposta(i.application_id, i.token, {
          embeds: [embedDeErro("Código vazio", "Gere um código em **/hunts**, no site.")],
        });
        return;
      }

      const supabase = clienteSemUsuario();
      const { data, error } = await supabase.rpc("vincular_discord", {
        p_codigo: codigo,
        p_discord_id: autor.id,
      });

      if (error) throw new Error(error.message);

      if (!data) {
        await editarResposta(i.application_id, i.token, {
          embeds: [
            embedDeErro(
              "Código inválido",
              "Ele pode ter expirado (valem 10 minutos), já ter sido usado, ou estar digitado errado. Gere outro no site.",
            ),
          ],
        });
        return;
      }

      await editarResposta(i.application_id, i.token, {
        embeds: [
          {
            title: "Conta vinculada",
            description:
              "Pronto. Agora `/addhunt` grava na sua conta do site e `/viewstats` lê de lá.",
            color: COR,
          },
        ],
      });
    } catch (e) {
      console.error("[discord] /cadastro falhou:", e);
      await editarResposta(i.application_id, i.token, {
        embeds: [embedDeErro("Erro ao vincular", (e as Error).message)],
      });
    }
  });

  return json(adiar(true));
}
