-- ============================================================================
-- lootibia — drops extras, avaliados pelo usuário
-- Rodar no SQL Editor do Supabase, DEPOIS de 0003_pastas_e_metas.sql.
-- ============================================================================
--
-- O `Loot` do Hunt Analyser avalia item por referência de NPC, e é ruim
-- justamente para o que interessa: rare. Esta tabela é o usuário corrigindo
-- essa avaliação onde ela erra mais — "caiu um Falcon Coif e vale 30kk".
--
-- **Não entra no profit, por decisão do Davi em 2026-09-23.** O valor de todo o
-- resto do app é que os números saíram do jogo, não de palpite. Misturar uma
-- estimativa do usuário no mesmo total apagaria essa fronteira, e o profit
-- deixaria de ser auditável contra o texto que ele colou. Os extras aparecem
-- ao LADO do profit, somados à parte.
--
-- RETENÇÃO (diretriz 12): não cresce com o tempo, cresce com decisão do
-- usuário — mesmo regime da `pasta`. Quem cria, apaga.

create table if not exists public.drop_extra (
  id         integer     primary key generated always as identity,
  usuario_id uuid        not null references auth.users(id) on delete cascade,
  -- Nulo = "Sem pasta", igual a `sessao.pasta_id`. `set null` e não `cascade`:
  -- apagar pasta é organizar, não destruir — e um rare anotado não some porque
  -- você reorganizou as pastas.
  pasta_id   integer     references public.pasta(id) on delete set null,
  -- Referencia o lookup em vez de guardar texto (diretriz 10). Quem insere só
  -- grava depois de o nome existir no TibiaWiki (`lib/tibiawiki.ts`), pelo
  -- mesmo motivo do personagem: campo livre polui vocabulário compartilhado
  -- (diretriz 49).
  item_id    smallint    not null references public.item(id),
  valor      integer     not null check (valor > 0),
  unidade    text        not null check (unidade in ('tc', 'gp')),
  criado_em  timestamptz not null default now()
);

comment on table public.drop_extra is
  'Drop avaliado pelo usuario. NAO entra no profit: fica ao lado, somado a parte. RETENCAO (diretriz 12): cresce por decisao do usuario, quem cria apaga.';
comment on column public.drop_extra.valor is
  'Em TC ou em gp, conforme `unidade`. Guarda valor+unidade, nunca o equivalente em gold: o preco da TC muda (mesma regra de pasta.meta_valor).';

-- A tela lista os extras de uma pasta, do mais recente para o mais antigo.
create index if not exists drop_extra_pasta_idx
  on public.drop_extra (usuario_id, pasta_id, criado_em desc);

-- ---------------------------------------------------------------------------
-- Row Level Security (diretriz 26) — os QUATRO verbos (diretriz 45)
-- ---------------------------------------------------------------------------
-- O `update` está aqui desde o começo de propósito. Em 2026-09-21 a `sessao`
-- não tinha política de update, e mover hunt para pasta falhava EM SILÊNCIO
-- com o PostgREST respondendo 200. Não repetir: tabela nasce com os quatro.

alter table public.drop_extra enable row level security;

drop policy if exists "drop_extra: dono le"       on public.drop_extra;
drop policy if exists "drop_extra: dono insere"   on public.drop_extra;
drop policy if exists "drop_extra: dono atualiza" on public.drop_extra;
drop policy if exists "drop_extra: dono apaga"    on public.drop_extra;

create policy "drop_extra: dono le" on public.drop_extra for select
  to authenticated using (auth.uid() = usuario_id);
create policy "drop_extra: dono insere" on public.drop_extra for insert
  to authenticated with check (auth.uid() = usuario_id);
-- `using` E `with check`: só com `using` eu alcanço a minha linha e gravo nela
-- o `usuario_id` de outra pessoa.
create policy "drop_extra: dono atualiza" on public.drop_extra for update
  to authenticated using (auth.uid() = usuario_id) with check (auth.uid() = usuario_id);
create policy "drop_extra: dono apaga" on public.drop_extra for delete
  to authenticated using (auth.uid() = usuario_id);

-- ---------------------------------------------------------------------------
-- Conferência (diretriz 13: medir, não estimar)
-- ---------------------------------------------------------------------------
-- select cmd, policyname from pg_policies
--  where schemaname = 'public' and tablename = 'drop_extra' order by cmd;
--   -- tem de vir QUATRO linhas: SELECT, INSERT, UPDATE, DELETE
--
-- select tablename, rowsecurity from pg_tables
--  where schemaname = 'public' and rowsecurity = false;   -- deve vir vazio
