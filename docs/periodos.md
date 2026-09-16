# Calendário do jogo: dias e semanas

> **EM USO.** [`lib/periodo.ts`](../lib/periodo.ts) é usado pela tela `/hunts` para agrupar sessões
> por semana, e a mesma regra está replicada em SQL na view `sessao_periodo`
> (`supabase/migrations/0001_schema.sql`). Escrito em 2026-09-16.

## Por que isto é um módulo, e não `new Date()`

**O dia do jogo vira no server save, não à meia-noite.** Todos os mundos salvam às **10:00:00 no
fuso `Europe/Berlin`**, padronizado desde **21/09/2011**; é nesse momento que o mundo reinicia,
a boosted creature troca e as world changes mudam. Um kill às 09:00 de Berlim pertence ao dia
*anterior*.

Fontes: [Server Save](https://tibia.fandom.com/wiki/Server_Save) e
[Boosted Creature](https://tibia.fandom.com/wiki/Boosted_Creature) no TibiaWiki.

Disso saem três armadilhas que o módulo existe para resolver:

1. **Fuso do usuário não serve.** O corte é sempre em horário de Berlim, não no de quem está olhando.
2. **Offset fixo quebra duas vezes por ano.** Berlim alterna CET (UTC+1) e CEST (UTC+2), então o
   server save é 09:00Z no inverno e 08:00Z no verão. Um `-3h` cravado no código erra metade do ano
   — e erra em silêncio, com os números só ficando "um pouco estranhos".
3. **Nem todo dia tem 24 h.** Nos domingos de transição o dia do jogo tem **23 h ou 25 h**. Qualquer
   cálculo que assuma 86.400.000 ms por dia erra nessas datas. Em 2026, por exemplo, o dia rotulado
   `2026-03-28` dura 23 h e o `2026-10-24` dura 25 h — a transição cai *dentro* do dia que começou
   na véspera, não no dia da data da transição.

## Modelo

**Dia de Tibia** — intervalo `[server save, próximo server save)`. O rótulo é a data ISO do server
save que **abriu** o dia: `'2026-09-16'`. Cabe num `date` de 4 bytes se um dia virar coluna
(diretriz 9).

**Semana** — ISO-8601: segunda a domingo, semana 1 é a que contém a primeira quinta-feira do ano,
rótulo `'2026-W38'`. As fronteiras são deslocadas para o server save, ou seja, a semana `2026-W38`
abre em `2026-09-14T08:00:00Z` e fecha exatamente onde `2026-W39` abre.

**Persistência** — instantes em UTC (`timestamptz`). Rótulo de dia e de semana são **derivados em
leitura, nunca gravados junto** (diretriz 6).

## Funções

| Função | Para quê |
|---|---|
| `diaTibia(instante)` | A que dia do jogo um instante pertence |
| `intervaloDoDia(dia)` | `[início, fim)` em UTC |
| `horasNoDia(dia)` | 23, 24 ou 25, conforme o DST |
| `semanaTibia(dia)` | Rótulo ISO da semana |
| `diasDaSemana(semana)` | Os sete dias, de segunda a domingo |
| `intervaloDaSemana(semana)` | `[início, fim)` em UTC |
| `diasEntre(de, até)` · `semanasEntre(de, até)` | Enumeração de períodos |
| `instanteDoServerSave(dia)` · `deslocamentoBerlim(instante)` | Primitivas de fuso |

Sem dependência externa: a conversão usa `Intl.DateTimeFormat`, que carrega o banco IANA do próprio
runtime.

## Testes

[`lib/periodo.test.ts`](../lib/periodo.test.ts) — 24 asserções, sem framework nem dependência:

```bash
node --experimental-strip-types lib/periodo.test.ts
```

Cobre as duas transições de DST de 2026, as fronteiras de 09:59 e 10:00 nos dois regimes de fuso,
viradas de mês e de ano, as viradas de semana ISO (`2025-12-29` é `2026-W01`; `2027-01-01` ainda é
`2026-W53`), ida e volta dia↔semana em 400 dias corridos, e encadeamento sem buraco nem sobreposição
entre dias e entre semanas. O somatório de horas de 2026 fecha em 8760, o que confirma que o dia de
23 h e o de 25 h se cancelam.

## Decisões em aberto

1. **A semana começa na segunda?** Adotei ISO-8601 por ser interoperável e sem ambiguidade, mas
   Tibia não tem conceito oficial de semana — a boosted creature e o Rashid giram por dia. Se o
   produto pedir outra âncora, muda aqui e só aqui.
2. **O rótulo de dia vira coluna ou fica derivado?** Depende do schema, que depende do escopo.
3. **Dados anteriores a 21/09/2011** não valem para este modelo: antes disso o horário de save
   variava por mundo. A constante `INICIO_SERVER_SAVE_PADRONIZADO` documenta o limite.
4. **Onde isso encosta nas APIs**: `/v4/killstatistics/{world}` devolve janelas `last_day_*` e
   `last_week_*` sem dizer a que datas correspondem — se formos guardar série histórica, é este
   módulo que dá nome a cada snapshot.
