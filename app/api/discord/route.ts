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
  opcaoBooleana,
  opcaoTexto,
  adiar,
  editarResposta,
  mensagem,
  modal,
  type Interacao,
  type Embed,
} from "@/lib/discord/protocolo";
import {
  COMANDO,
  MODAL,
  CAMPO,
  CAMPOS_ADDHUNT,
  CAMPOS_CADASTRO,
} from "@/lib/discord/comandos";
import { embedDeResumo, embedDeErro, compacto, horas } from "@/lib/discord/embed";
import { janelaDe, lerRotulo, descreverJanela } from "@/lib/discord/janela";
import { clienteDoUsuario, clienteSemUsuario, usuarioDoDiscord } from "@/lib/supabase/bot";
import { importarSessao } from "@/lib/importacao";
import { resumoDoPeriodo } from "@/lib/consulta";
import { COR } from "@/lib/discord/protocolo";

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

  if (interacao.type === TipoDeInteracao.MODAL_SUBMIT) {
    return responderModal(interacao);
  }

  return json({ erro: "tipo de interação não tratado" }, 400);
}

// ---------------------------------------------------------------------------
// Slash commands
// ---------------------------------------------------------------------------

function responderComando(i: Interacao): Response {
  switch (i.data?.name) {
    case COMANDO.ADDHUNT:
      // Sem defer: modal tem de ser a resposta inicial.
      return json(modal(MODAL.ADDHUNT, "Importar sessão", CAMPOS_ADDHUNT));

    case COMANDO.CADASTRO:
      return json(modal(MODAL.CADASTRO, "Vincular conta do lootibia", CAMPOS_CADASTRO));

    case COMANDO.VIEWSTATS:
      return comandoViewstats(i);

    default:
      return json(mensagem("Comando desconhecido."));
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
      const { resumo, truncado } = await resumoDoPeriodo(supabase, {
        inicio: janela.inicio,
        fim: janela.fim,
        personagem,
      });

      const embed = embedDeResumo(resumo, {
        janela,
        personagem,
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

      const rotulos = [personagem, spot].filter(Boolean).join(" · ");
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
              text: spot
                ? "Use /viewstats para ver o acumulado."
                : "Sem local: esta hunt não entra em “hunts mais caçadas”.",
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
