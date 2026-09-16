# Analisador de Hunts — formato, métricas e dimensionamento

> **EM USO.** [`lib/huntSession.ts`](../lib/huntSession.ts) e
> [`lib/huntAgregado.ts`](../lib/huntAgregado.ts) alimentam a tela `/hunts`. O schema está em
> `supabase/migrations/0001_schema.sql` e **ainda não foi aplicado num projeto real**.

## O que o app faz

Tela principal: o usuário cola o texto que o Hunt Analyser do Tibia copia, o app parseia, guarda a
sessão e mostra os acumulados do período (semana, por padrão):

profit acumulado · loot acumulado · XP e XP Raw · supplies total e média · profit/loot médio ·
médias de XP e XP Raw · mobs mortos no período · hunts mais caçadas.

## O formato

```
Session data: From 2026-09-15, 19:34:12 to 2026-09-15, 21:25:10
Session: 01:50h
Raw XP Gain: 7,051,729
XP Gain: 10,577,467
Raw XP/h: 3,812,527
XP/h: 5,718,723
Loot: 2,450,488
Supplies: 303,842
Balance: 2,146,646
Damage: 10,756,966
Damage/h: 5,819,757
Healing: 2,158,980
Healing/h: 1,168,056
Killed Monsters:
437x betrayed wraith
...
Looted Items:
413x a great mana potion
...
```

### O que a análise do exemplo revelou

**1. `Balance` é exatamente `Loot − Supplies`.** Conferido: 2.450.488 − 303.842 = 2.146.646. É campo
derivado — o parser confere e recusa o texto se divergir, mas **não se persiste** (diretriz 6).

**2. Os campos `/h` do jogo não são reproduzíveis.** Dividindo os totais pela duração exata
(1h50m58s = 6.658 s):

| Campo | Calculado | Exibido pelo jogo | Erro |
|---|---|---|---|
| Raw XP/h | 3.812.890 | 3.812.527 | +0,010 % |
| XP/h | 5.719.267 | 5.718.723 | +0,010 % |
| Damage/h | 5.816.323 | 5.819.757 | −0,059 % |
| Healing/h | 1.167.367 | 1.168.056 | −0,059 % |

XP e Damage erram em **sentidos opostos**, então nenhuma duração única reproduz os quatro — o jogo
mede as duas famílias em janelas internas ligeiramente diferentes. Consequência: **ignorar os `/h`
do texto** e calcular toda taxa a partir dos totais. O parser os lê apenas como diagnóstico.

**3. `Session: 01:50h` trunca os minutos.** A sessão durou 1h50m58s; usar o valor exibido erra
0,9 %. A duração de verdade vem de `fim − início`.

**4. Os horários não têm fuso.** São o relógio local de quem jogou. Converter em instante exige o
**fuso IANA do usuário, que o app precisa capturar na importação** — sem ele não dá para dizer a que
dia de Tibia a sessão pertence (ver [periodos.md](periodos.md)). Ressalva conhecida: uma sessão que
atravesse a virada de horário de verão *local* terá duração errada em uma hora; é caso raro e está
registrado aqui, não tratado.

**5. O Hunt Analyser não informa o local da hunt.** "Hunts mais caçadas" depende de um rótulo que o
**usuário** dá à sessão ("Asura Palace"). Sem isso a métrica não existe — o resumo conta as sessões
sem rótulo em `huntsSemRotulo` para o app poder pedir o nome.

## A regra que rege toda a agregação

> **Nunca tirar média das médias.** Toda taxa é `Σ total / Σ horas`.

Uma hunt de 10 min com XP/h inflado pesa igual a uma de 4 h numa média simples. No teste, duas
sessões de 100k em 10 min e 400k em 4 h dão **120.000/h** ponderado pelo tempo contra **350.000/h**
na média ingênua — quase o triplo. Por isso o tipo de entrada da agregação nem expõe taxa por
sessão: só totais e duração.

Outro detalhe: conjunto vazio devolve `null`, não zero. "Sem dados" não é "zero por hora".

## Dimensionamento no orçamento de 500 MB

Com o schema normalizado que as diretrizes 9 e 10 exigem — `sessao` com métricas em `int4`, e
detalhes como `(sessao_id int4, entidade_id int2, quantidade int4)` referenciando tabelas de lookup:

| | bytes |
|---|---|
| linha de `sessao` + PK + índice `(usuario, inicio)` | 116 |
| linha de detalhe + índice | 60 |
| detalhes por sessão (exemplo real: 6 monstros + 7 itens) | 13 |
| **custo total por hunt** | **896** |

| Cenário | Hunts/ano | Tamanho | % de 500 MB |
|---|---|---|---|
| 1 usuário, 5 hunts/dia | 1.825 | 1,6 MB | 0,3 % |
| 50 usuários, 5/dia | 91.250 | 78 MB | 15,6 % |
| 500 usuários, 5/dia | 912.500 | 780 MB | **156 %** |

**Teto prático: ~410.000 hunts**, deixando 30 % de folga para bloat, WAL e tabelas de lookup.

Duas conclusões:

- **Uso pessoal é irrelevante** — 1,6 MB por ano. O limite só aperta na casa das centenas de usuários.
- **As linhas de detalhe são 87 % do custo** (780 dos 896 bytes). Se um dia for preciso cortar, é aí:
  agregar monstros/itens por semana e descartar o detalhe por sessão depois de N dias — a política
  de retenção que a diretriz 12 exige. Guardar o texto colado cru multiplicaria isso por ~10 e está
  vedado pela diretriz 7.

## Arquivos

| Arquivo | Conteúdo |
|---|---|
| [`lib/huntSession.ts`](../lib/huntSession.ts) | Parser do texto → `SessaoHunt` tipada |
| [`lib/huntAgregado.ts`](../lib/huntAgregado.ts) | `resumirHunts` e `resumirPorPeriodo` |
| [`lib/hunt.test.ts`](../lib/hunt.test.ts) | 45 asserções, sem framework |

```bash
node --experimental-strip-types lib/hunt.test.ts
```

## Em aberto

1. **Plural dos nomes.** O jogo escreve `great mana potions` no plural; o wiki indexa
   `Great Mana Potion`. O parser remove o artigo mas **não** resolve plural — o de-para é tabela à
   parte (diretriz 23). Sem isso não dá para cruzar loot com `npcvalue` do wiki.
2. **Variantes do formato.** Só o Hunt Analyser pessoal foi analisado; o de party tem outro layout
   (por jogador). Campos desconhecidos já caem em `camposIgnorados` sem quebrar o parse.
3. **Valor do loot.** O `Loot` que o jogo dá já vem em gold; nenhuma API tem preço de Market
   (diretriz 24), então comparar com preço real de mercado continua fora de alcance.
4. **Fuso do usuário**: onde capturar e como guardar (perfil? por sessão?).
