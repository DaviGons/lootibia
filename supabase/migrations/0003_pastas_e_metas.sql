-- ===========================================================================
-- 0003 — Pastas com meta, preço da Tibia Coin por mundo, e personagem com os
--        dados da TibiaData.
-- ===========================================================================
--
-- Rodar inteiro no SQL Editor do Supabase. É idempotente: `if not exists` em
-- tudo que cria, `drop policy if exists` antes de cada política.
--
-- O que muda no produto: a semana deixa de ser o eixo da tela. Quem organiza
-- passa a ser a PASTA, criada e nomeada pelo usuário, com meta opcional em TC
-- ou em gp. `lib/periodo.ts` continua de pé — ele é quem sabe que dia de Tibia
-- é hoje, e é disso que dependem o `/viewstats` do bot e a cidade do Rashid.

-- ---------------------------------------------------------------------------
-- Pastas
-- ---------------------------------------------------------------------------
-- `ordem` é a prioridade que o usuário arrasta. `smallint` porque ninguém vai
-- ter 32 mil pastas, e `integer` aqui seria o dobro do necessário (diretriz 9).
--
-- A meta guarda VALOR + UNIDADE, não o equivalente em gp. Se guardássemos gp,
-- uma meta de "500 TC" viraria outra coisa no dia em que o preço da TC mudasse.
-- Guardando a unidade, 500 TC continuam 500 TC e o alvo em gp é recalculado ao
-- preço vigente — que é o comportamento que não surpreende ninguém.
--
-- Limite honesto: o profit foi acumulado ao longo de semanas com preços
-- diferentes, então "quanto isso vale em TC" é sempre aproximação ao preço de
-- hoje. Serve para acompanhar meta; não serve como contabilidade.
--
-- Sobre a ORDEM das colunas: aqui ela segue a leitura, não o alinhamento. A
-- diretriz 9 vale para tabela que cresce — `sessao`, `sessao_monstro` —, e esta
-- guarda algumas dezenas de linhas por conta. Trocar clareza por bytes de
-- padding que ninguém vai medir seria otimizar o lado errado.

create table if not exists public.pasta (
  id          integer  primary key generated always as identity,
  usuario_id  uuid     not null references auth.users(id) on delete cascade,
  nome        text     not null check (length(btrim(nome)) between 1 and 60),
  -- Nulo = pasta sem meta. As duas colunas andam juntas: ou ambas preenchidas,
  -- ou ambas nulas. Meta sem unidade é número sem significado.
  meta_valor   integer check (meta_valor > 0),
  meta_unidade text    check (meta_unidade in ('tc', 'gp')),
  ordem       smallint not null default 0,
  criada_em   date     not null default current_date,
  constraint pasta_meta_completa check (
    (meta_valor is null and meta_unidade is null) or
    (meta_valor is not null and meta_unidade is not null)
  ),
  -- Dois "Roshamuul" na mesma conta seriam indistinguíveis na lateral.
  unique (usuario_id, nome)
);

comment on table public.pasta is
  'RETENCAO (diretriz 12): nao cresce com o tempo, cresce com decisao do usuario. Apagar pasta NAO apaga hunt — ver o on delete set null em sessao.pasta_id.';

-- Única consulta que existe: "minhas pastas, na minha ordem".
create index if not exists pasta_usuario_ordem_idx
  on public.pasta (usuario_id, ordem, id);

-- ---------------------------------------------------------------------------
-- A sessão aponta para a pasta
-- ---------------------------------------------------------------------------
-- `on delete set null` NÃO é detalhe: apagar uma pasta é organizar, não
-- destruir. A hunt cai no balde "Sem pasta" e continua contando em "Todas as
-- hunts". `cascade` aqui apagaria meses de importação num clique.
--
-- Custo: 4 bytes por sessão. A cauda de `sessao` hoje é
-- `... healing integer, spot_id smallint, personagem_id smallint` — 4+2+2, já
-- alinhado em 8. O `integer` entra encaixado, sem byte de padding jogado fora.

alter table public.sessao
  add column if not exists pasta_id integer references public.pasta(id) on delete set null;

-- Parcial: a maioria das sessões fica sem pasta, e indexar nulo é espaço morto
-- (diretriz 11).
create index if not exists sessao_pasta_idx
  on public.sessao (pasta_id) where pasta_id is not null;

-- ---------------------------------------------------------------------------
-- Preço da Tibia Coin, por MUNDO
-- ---------------------------------------------------------------------------
-- Por mundo e não por personagem, de propósito. Três chars em Bona compartilham
-- o mesmo mercado; guardar o preço em cada um significaria atualizar três
-- lugares e conviver com eles divergindo em silêncio.
--
-- `preco_tc` é inteiro em gp (diretriz 9): `numeric` custaria mais e ninguém
-- negocia fração de gold. O valor é a estimativa DO USUÁRIO — nenhuma das duas
-- APIs publica preço de mercado (diretriz 24), então não há de onde buscar.

create table if not exists public.config_mundo (
  usuario_id uuid    not null references auth.users(id) on delete cascade,
  mundo      text    not null,
  preco_tc   integer not null check (preco_tc > 0),
  -- PK composta serve de índice: a consulta é sempre "meus mundos".
  primary key (usuario_id, mundo)
);

comment on table public.config_mundo is
  'Preco da TC em gp, estimado pelo usuario. Nenhuma API publica preco de mercado (diretriz 24).';

-- ---------------------------------------------------------------------------
-- Personagem ganha o que a TibiaData sabe
-- ---------------------------------------------------------------------------
-- A tabela nasceu em 0002 como lookup compartilhado, e continua sendo: nome de
-- personagem é único no Tibia inteiro, então mundo, level e vocação são fato
-- global, não preferência de usuário.
--
-- `visto_em` é quando a TibiaData foi consultada. Level envelhece rápido; sem
-- essa coluna a tela mostraria um número velho como se fosse de agora.

alter table public.personagem
  add column if not exists mundo    text,
  add column if not exists vocacao  text,
  add column if not exists nivel    integer check (nivel > 0),
  add column if not exists visto_em timestamptz;

comment on column public.personagem.visto_em is
  'Quando a TibiaData respondeu. Nulo = personagem cadastrado a mao, sem consulta.';

-- ---------------------------------------------------------------------------
-- Quais personagens são meus
-- ---------------------------------------------------------------------------
-- Até agora "meus personagens" era dedução: os que aparecem nas minhas sessões.
-- Isso quebra na tela de configuração, onde você cadastra o char ANTES de ter
-- importado qualquer hunt com ele. Daí a junção explícita.
--
-- 22 bytes por linha, e ninguém tem mais que uma dúzia de chars.

create table if not exists public.usuario_personagem (
  usuario_id    uuid     not null references auth.users(id) on delete cascade,
  personagem_id smallint not null references public.personagem(id) on delete cascade,
  primary key (usuario_id, personagem_id)
);

-- ---------------------------------------------------------------------------
-- RLS — diretriz 26, no mesmo migration que cria a tabela
-- ---------------------------------------------------------------------------

alter table public.pasta              enable row level security;
alter table public.config_mundo       enable row level security;
alter table public.usuario_personagem enable row level security;

-- Pasta: cada um só enxerga e mexe nas suas.
drop policy if exists "pasta: dono le"       on public.pasta;
drop policy if exists "pasta: dono insere"   on public.pasta;
drop policy if exists "pasta: dono atualiza" on public.pasta;
drop policy if exists "pasta: dono apaga"    on public.pasta;
create policy "pasta: dono le" on public.pasta for select
  to authenticated using (auth.uid() = usuario_id);
create policy "pasta: dono insere" on public.pasta for insert
  to authenticated with check (auth.uid() = usuario_id);
create policy "pasta: dono atualiza" on public.pasta for update
  to authenticated using (auth.uid() = usuario_id) with check (auth.uid() = usuario_id);
create policy "pasta: dono apaga" on public.pasta for delete
  to authenticated using (auth.uid() = usuario_id);

-- Config de mundo: idem.
drop policy if exists "config_mundo: dono le"       on public.config_mundo;
drop policy if exists "config_mundo: dono insere"   on public.config_mundo;
drop policy if exists "config_mundo: dono atualiza" on public.config_mundo;
drop policy if exists "config_mundo: dono apaga"    on public.config_mundo;
create policy "config_mundo: dono le" on public.config_mundo for select
  to authenticated using (auth.uid() = usuario_id);
create policy "config_mundo: dono insere" on public.config_mundo for insert
  to authenticated with check (auth.uid() = usuario_id);
create policy "config_mundo: dono atualiza" on public.config_mundo for update
  to authenticated using (auth.uid() = usuario_id) with check (auth.uid() = usuario_id);
create policy "config_mundo: dono apaga" on public.config_mundo for delete
  to authenticated using (auth.uid() = usuario_id);

-- Vínculo usuário↔personagem: idem.
drop policy if exists "usuario_personagem: dono le"     on public.usuario_personagem;
drop policy if exists "usuario_personagem: dono insere" on public.usuario_personagem;
drop policy if exists "usuario_personagem: dono apaga"  on public.usuario_personagem;
create policy "usuario_personagem: dono le" on public.usuario_personagem for select
  to authenticated using (auth.uid() = usuario_id);
create policy "usuario_personagem: dono insere" on public.usuario_personagem for insert
  to authenticated with check (auth.uid() = usuario_id);
create policy "usuario_personagem: dono apaga" on public.usuario_personagem for delete
  to authenticated using (auth.uid() = usuario_id);

-- `sessao` ganha UPDATE, que não existia em 0001.
--
-- O 0001 criou select, insert e delete e parou aí, porque na época nada editava
-- sessão. Mover uma hunt para uma pasta é um `update sessao set pasta_id`, e sem
-- política a RLS **nega em silêncio**: o Postgres não vê linha alguma para
-- atualizar, o PostgREST devolve sucesso com zero linhas afetadas, e a tela não
-- tem como saber que nada aconteceu. Foi exatamente o sintoma — a hunt clicada
-- simplesmente não ia para a pasta.
--
-- O `using` diz quais linhas posso alcançar e o `with check` quais posso
-- deixar gravadas. Os dois são obrigatórios: só com `using`, eu poderia pegar
-- a minha sessão e carimbar nela o `usuario_id` de outra pessoa.
drop policy if exists "sessao: dono atualiza" on public.sessao;
create policy "sessao: dono atualiza" on public.sessao for update
  to authenticated using (auth.uid() = usuario_id) with check (auth.uid() = usuario_id);

-- Personagem ganha UPDATE, que não existia em 0002.
--
-- Sem isto não dá para gravar mundo/level/vocação, nem atualizar o level quando
-- o char sobe. O regime continua o dos outros lookups: vocabulário partilhado,
-- todo autenticado escreve.
--
-- Ressalva registrada: qualquer usuário pode alterar a linha de qualquer
-- personagem. Num grupo fechado é aceitável, e o estrago se desfaz sozinho —
-- os campos vêm da TibiaData e a próxima consulta sobrescreve. Se um dia isto
-- virar produto aberto, o certo é mover estes campos para uma tabela escrita
-- só por `security definer`.
drop policy if exists "personagem: autenticado atualiza" on public.personagem;
create policy "personagem: autenticado atualiza" on public.personagem for update
  to authenticated using (true) with check (true);

-- ---------------------------------------------------------------------------
-- A view precisa ser recriada — pelo mesmo motivo de 0002
-- ---------------------------------------------------------------------------
-- `sessao_periodo` é `select s.*`. Com `pasta_id` entrando em `sessao`, tudo
-- que vinha depois anda uma casa, e `create or replace view` lê isso como
-- renomear coluna:
--
--   ERROR: cannot change name of view column "balance" to "pasta_id"
--
-- `drop` antes resolve: view não guarda dado, é consulta salva.
--
-- `security_invoker` vai INLINE, não num `alter view` depois: entre um
-- `create view` nu e o `alter` existe um instante em que a view roda com os
-- privilégios do dono e ignora a RLS.

drop view if exists public.sessao_periodo;

create view public.sessao_periodo
  with (security_invoker = on)
as
select
  s.*,
  (s.loot - s.supplies)                                            as balance,
  ((s.inicio at time zone 'Europe/Berlin') - interval '10 hours')::date
                                                                   as dia_tibia,
  to_char(((s.inicio at time zone 'Europe/Berlin') - interval '10 hours')::date,
          'IYYY-"W"IW')                                            as semana_tibia
from public.sessao s;

grant select on public.sessao_periodo to authenticated;

-- ---------------------------------------------------------------------------
-- Conferência (diretriz 13: medir, não estimar)
-- ---------------------------------------------------------------------------
-- Nenhuma tabela pode ficar sem RLS — tem de vir vazio:
--   select tablename from pg_tables
--    where schemaname = 'public' and rowsecurity = false;
--
-- As três novas existem e estão protegidas:
--   select relname, relrowsecurity from pg_class
--    where relname in ('pasta','config_mundo','usuario_personagem');
--
-- A view voltou com as colunas na ordem certa:
--   select column_name from information_schema.columns
--    where table_name = 'sessao_periodo' order by ordinal_position;
--
-- Tamanho do banco:
--   select pg_size_pretty(pg_database_size(current_database()));
