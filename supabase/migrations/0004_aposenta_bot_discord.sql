-- ===========================================================================
-- 0004 — Aposenta o bot do Discord: derruba o que era só dele.
-- ===========================================================================
--
-- Rodar inteiro no SQL Editor do Supabase, depois do 0003. É idempotente:
-- `if exists` em tudo que remove.
--
-- O bot foi aposentado em 2026-09-22 (ver docs/bot-discord.md). O código saiu
-- da `main` e vive na branch `abandonado/bot-discord`. O schema dele ficaria
-- para trás sem isto.
--
-- O motivo NÃO é espaço: `codigo_vinculo` guardava no máximo uma linha por
-- usuário e as funções não ocupam nada. É superfície.
-- `vincular_discord` e `usuario_do_discord` são `security definer` com
-- `grant execute to authenticated` — qualquer pessoa logada podia chamá-las,
-- e elas existiam para atravessar a RLS de propósito, num recurso que deixou
-- de existir. Código morto que ainda responde é pior que código morto.
--
-- ---------------------------------------------------------------------------
-- O QUE FICA, e por quê
-- ---------------------------------------------------------------------------
--
--   * `personagem` e `sessao.personagem_id` — nasceram no 0002 junto com o bot,
--     mas quem usa hoje é a tela. Nada a ver com Discord.
--
--   * `perfil` e `perfil.fuso` — a tabela nasceu para o bot herdar o fuso de
--     alguém, já que ele não tem navegador. O bot foi embora; o fuso ficou, e é
--     o que diz a que dia de Tibia uma sessão pertence, porque o Hunt Analyser
--     não escreve fuso nenhum (docs/periodos.md). `app/hunts/acoes.ts` grava
--     essa coluna a cada importação.
--
-- Só `perfil.discord_id` sai, porque é a única parte da tabela que era do bot.

-- ---------------------------------------------------------------------------
-- Funções
-- ---------------------------------------------------------------------------
-- Antes das tabelas: `vincular_discord` escreve em `perfil` e lê
-- `codigo_vinculo`, e derrubar a tabela primeiro deixaria a função quebrada
-- num intervalo em que ela ainda responderia.

drop function if exists public.vincular_discord(text, text);
drop function if exists public.usuario_do_discord(text);
drop function if exists public.limpar_codigos_expirados();

-- ---------------------------------------------------------------------------
-- Código de vínculo
-- ---------------------------------------------------------------------------
-- Era código de uso único gerado no site e queimado pelo `/cadastro`. Sem o
-- bot, ninguém gera e ninguém consome. O índice parcial e as políticas de RLS
-- somem junto com a tabela — não precisam de `drop` próprio.

drop table if exists public.codigo_vinculo;

-- ---------------------------------------------------------------------------
-- O vínculo em si
-- ---------------------------------------------------------------------------
-- `discord_id` guardava o snowflake de quem tinha rodado `/cadastro`. É dado
-- de verdade sendo apagado, e não há como recuperá-lo: se o bot voltar, cada
-- pessoa roda o vínculo de novo. São dois cliques, e manter uma coluna com o
-- identificador de rede de alguém "por via das dúvidas" é o oposto do que se
-- deve fazer com dado pessoal de um recurso desligado.

alter table public.perfil drop column if exists discord_id;

comment on table public.perfil is
  'Fuso IANA do usuario, capturado no navegador. Nasceu para o bot do Discord (aposentado em 2026-09-22); o fuso ficou porque o Hunt Analyser nao escreve fuso nenhum.';

-- ---------------------------------------------------------------------------
-- Conferência (diretriz 45: olhar os quatro verbos, e o que sobrou)
-- ---------------------------------------------------------------------------
-- Nenhuma destas três deve voltar linha:
--
-- select routine_name from information_schema.routines
--  where routine_schema = 'public'
--    and routine_name in ('vincular_discord','usuario_do_discord','limpar_codigos_expirados');
--
-- select tablename from pg_tables
--  where schemaname = 'public' and tablename = 'codigo_vinculo';
--
-- select column_name from information_schema.columns
--  where table_name = 'perfil' and column_name = 'discord_id';
--
-- E a RLS continua ligada em tudo que sobrou:
--
-- select tablename, rowsecurity from pg_tables
--  where schemaname = 'public' and rowsecurity = false;   -- deve vir vazio
