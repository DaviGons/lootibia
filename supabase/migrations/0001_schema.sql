-- ============================================================================
-- lootibia — schema inicial do Analisador de Hunts
-- Rodar no SQL Editor do Supabase. Idempotente o suficiente para reexecução
-- em projeto limpo; NÃO é migration reversível.
-- ============================================================================
--
-- Decisões de armazenamento (orçamento de 500 MB, diretrizes 6 a 13):
--
--   * `balance` NÃO existe como coluna: é sempre `loot - supplies` (diretriz 6).
--   * As taxas `/h` do Hunt Analyser não são armazenadas: não são reproduzíveis
--     e toda taxa é calculada como `Σ total / Σ horas` na leitura.
--   * Nome de monstro e de item viram lookup com id `smallint` (diretriz 10).
--     Uma linha de detalhe custa 10 bytes de dados em vez de ~30 de texto.
--   * Métricas em `integer`: o maior valor plausível por sessão (XP de ~10 M,
--     dano de ~11 M) cabe folgado em 2,1 bi. Totais de período são somados em
--     `bigint` na consulta, não na coluna.
--   * `usuario_id` é `uuid` por imposição do `auth.users` do Supabase — é o
--     único campo largo que não dá para evitar.
--   * Ordem das colunas segue do mais largo para o mais estreito, para reduzir
--     o padding de alinhamento do Postgres.
--
-- Custo medido do desenho: ~896 bytes por hunt (116 da sessão + 13 linhas de
-- detalhe a 60 bytes). Teto prático ~410 mil hunts. Ver docs/hunt-analyser.md.
--
-- RETENÇÃO (diretriz 12): as tabelas de detalhe são 87% do custo. Quando
-- passarem de ~300 mil linhas por usuário, agregar por semana e descartar o
-- detalhe por sessão com mais de N dias. Política ainda não implementada.

-- ---------------------------------------------------------------------------
-- Lookups
-- ---------------------------------------------------------------------------

-- Nomes como o JOGO escreve (minúsculo, às vezes plural). O de-para com os
-- títulos do TibiaWiki é problema à parte e ainda não existe (diretriz 23).
create table if not exists public.monstro (
  id   smallint primary key generated always as identity,
  nome text     not null unique
);

create table if not exists public.item (
  id   smallint primary key generated always as identity,
  nome text     not null unique
);

-- Local da hunt. O Hunt Analyser não fornece: é rótulo dado pelo usuário.
create table if not exists public.spot (
  id   smallint primary key generated always as identity,
  nome text     not null unique
);

comment on table public.monstro is 'Teto de 32.767 nomes (smallint). O wiki tem ~2 mil criaturas.';
comment on table public.item    is 'Teto de 32.767 nomes (smallint). O wiki tem ~6,5 mil itens.';

-- ---------------------------------------------------------------------------
-- Sessões
-- ---------------------------------------------------------------------------

create table if not exists public.sessao (
  id         integer     primary key generated always as identity,
  -- Instante REAL de início, já convertido do relógio local do jogador usando
  -- o fuso IANA capturado no navegador durante a importação.
  inicio     timestamptz not null,
  criado_em  timestamptz not null default now(),
  usuario_id uuid        not null references auth.users(id) on delete cascade,
  -- Duração de `fim - inicio`, não o `Session: 01:50h` exibido, que trunca.
  duracao_s  integer     not null check (duracao_s > 0),
  raw_xp     integer     not null check (raw_xp   >= 0),
  xp         integer     not null check (xp       >= 0),
  loot       integer     not null check (loot     >= 0),
  supplies   integer     not null check (supplies >= 0),
  damage     integer     not null check (damage   >= 0),
  healing    integer     not null check (healing  >= 0),
  spot_id    smallint    references public.spot(id) on delete set null,
  -- Impede importar a mesma sessão duas vezes.
  unique (usuario_id, inicio)
);

-- Única consulta que existe hoje: "minhas sessões, do período X".
create index if not exists sessao_usuario_inicio_idx
  on public.sessao (usuario_id, inicio desc);

create table if not exists public.sessao_monstro (
  sessao_id  integer  not null references public.sessao(id)  on delete cascade,
  monstro_id smallint not null references public.monstro(id),
  quantidade integer  not null check (quantidade > 0),
  -- PK composta serve de índice de junção: evita uma coluna `id` e um índice.
  primary key (sessao_id, monstro_id)
);

create table if not exists public.sessao_item (
  sessao_id  integer  not null references public.sessao(id) on delete cascade,
  item_id    smallint not null references public.item(id),
  quantidade integer  not null check (quantidade > 0),
  primary key (sessao_id, item_id)
);

-- ---------------------------------------------------------------------------
-- Calendário do jogo, em SQL
-- ---------------------------------------------------------------------------
--
-- Mesma regra de lib/periodo.ts: o dia do jogo vira no server save, às 10:00 de
-- Europe/Berlin. `at time zone` resolve o horário de verão sozinho, então
-- subtrair 10 h do relógio de Berlim e truncar em data dá o dia correto tanto
-- em CET quanto em CEST.
--
-- A semana é ISO-8601 (`IYYY`/`IW`), igual à do módulo TypeScript.

create or replace view public.sessao_periodo as
select
  s.*,
  (s.loot - s.supplies)                                            as balance,
  ((s.inicio at time zone 'Europe/Berlin') - interval '10 hours')::date
                                                                   as dia_tibia,
  to_char(((s.inicio at time zone 'Europe/Berlin') - interval '10 hours')::date,
          'IYYY-"W"IW')                                            as semana_tibia
from public.sessao s;

-- ---------------------------------------------------------------------------
-- Row Level Security (diretriz 26)
-- ---------------------------------------------------------------------------
-- A chave publicável roda no navegador. Sem RLS, qualquer pessoa lê e escreve
-- tudo. Toda tabela abaixo liga RLS e declara políticas explícitas.

alter table public.sessao         enable row level security;
alter table public.sessao_monstro enable row level security;
alter table public.sessao_item    enable row level security;
alter table public.monstro        enable row level security;
alter table public.item           enable row level security;
alter table public.spot           enable row level security;

-- Sessões: cada um só enxerga e mexe no que é seu.
drop policy if exists "sessao: dono le"     on public.sessao;
drop policy if exists "sessao: dono insere" on public.sessao;
drop policy if exists "sessao: dono apaga"  on public.sessao;

create policy "sessao: dono le"     on public.sessao for select
  to authenticated using (auth.uid() = usuario_id);
create policy "sessao: dono insere" on public.sessao for insert
  to authenticated with check (auth.uid() = usuario_id);
create policy "sessao: dono apaga"  on public.sessao for delete
  to authenticated using (auth.uid() = usuario_id);

-- Detalhe: o acesso é herdado da sessão dona.
drop policy if exists "sessao_monstro: dono le"     on public.sessao_monstro;
drop policy if exists "sessao_monstro: dono insere" on public.sessao_monstro;
create policy "sessao_monstro: dono le" on public.sessao_monstro for select
  to authenticated using (exists (
    select 1 from public.sessao s
     where s.id = sessao_id and s.usuario_id = auth.uid()));
create policy "sessao_monstro: dono insere" on public.sessao_monstro for insert
  to authenticated with check (exists (
    select 1 from public.sessao s
     where s.id = sessao_id and s.usuario_id = auth.uid()));

drop policy if exists "sessao_item: dono le"     on public.sessao_item;
drop policy if exists "sessao_item: dono insere" on public.sessao_item;
create policy "sessao_item: dono le" on public.sessao_item for select
  to authenticated using (exists (
    select 1 from public.sessao s
     where s.id = sessao_id and s.usuario_id = auth.uid()));
create policy "sessao_item: dono insere" on public.sessao_item for insert
  to authenticated with check (exists (
    select 1 from public.sessao s
     where s.id = sessao_id and s.usuario_id = auth.uid()));

-- Lookups: vocabulário compartilhado. Todo mundo autenticado lê e pode
-- acrescentar nome novo, mas ninguém altera nem apaga o que já existe.
--
-- RISCO ACEITO PARA TESTE: um usuário autenticado consegue poluir os lookups
-- com nomes inventados. O endurecimento é mover a inserção para uma função
-- `security definer` que só aceita nomes vindos de um parse válido. Fica para
-- quando houver usuário além de nós.
do $$
declare t text;
begin
  foreach t in array array['monstro','item','spot'] loop
    execute format('drop policy if exists "%s: autenticado le" on public.%I', t, t);
    execute format('drop policy if exists "%s: autenticado insere" on public.%I', t, t);
    execute format('create policy "%s: autenticado le" on public.%I for select to authenticated using (true)', t, t);
    execute format('create policy "%s: autenticado insere" on public.%I for insert to authenticated with check (true)', t, t);
  end loop;
end $$;

-- A view herda a RLS das tabelas base (security_invoker), então não precisa de
-- política própria — mas precisa ser explícita quanto a isso.
alter view public.sessao_periodo set (security_invoker = on);

grant select on public.sessao_periodo to authenticated;

-- ---------------------------------------------------------------------------
-- Consulta de tamanho (diretriz 13: medir, não estimar)
-- ---------------------------------------------------------------------------
-- select
--   relname,
--   pg_size_pretty(pg_total_relation_size(c.oid)) as total
-- from pg_class c join pg_namespace n on n.oid = c.relnamespace
-- where n.nspname = 'public' and c.relkind = 'r'
-- order by pg_total_relation_size(c.oid) desc;
--
-- select pg_size_pretty(pg_database_size(current_database()));
