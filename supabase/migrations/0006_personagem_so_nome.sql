-- ============================================================================
-- lootibia — personagem vira só nome (2026-09-27)
-- Rodar no SQL Editor do Supabase DEPOIS de 0005_endurecimento.sql E DEPOIS do
-- deploy do código que lê mundo, vocação e level de `usuario_personagem`.
-- ============================================================================
--
-- É a segunda metade da mudança 4 do 0005. Lá os fatos do char ganharam lugar
-- em `usuario_personagem`, e as colunas de `personagem` ficaram porque o código
-- antigo ainda as lia. Com o código novo no ar, ninguém mais lê nem escreve
-- nelas — e o que sobra é justamente o que o 0005 existiu para fechar: uma
-- política que deixa qualquer conta alterar a linha de qualquer personagem.
--
-- Aplicar ANTES do deploy quebraria o código antigo: a tela de /config e a de
-- /hunts leem `personagem.mundo`, e o cadastro faz `upsert` com `do update`,
-- que sem política de update é recusado.

-- Sem esta política, `personagem` fica como os outros lookups: todo
-- autenticado lê e acrescenta, ninguém altera nem apaga.
drop policy if exists "personagem: autenticado atualiza" on public.personagem;

alter table public.personagem
  drop column if exists mundo,
  drop column if exists vocacao,
  drop column if exists nivel,
  drop column if exists visto_em;

comment on table public.personagem is
  'Nome do personagem: vocabulario compartilhado, so insercao. Mundo, vocacao e level sao de cada usuario, em usuario_personagem (0005).';

-- ---------------------------------------------------------------------------
-- Conferência
-- ---------------------------------------------------------------------------
-- `personagem` tem de ter só SELECT e INSERT:
--   select cmd, policyname from pg_policies
--    where schemaname = 'public' and tablename = 'personagem' order by cmd;
--
-- E só `id` e `nome`:
--   select column_name from information_schema.columns
--    where table_schema = 'public' and table_name = 'personagem' order by ordinal_position;
