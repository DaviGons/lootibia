# Registro de decisões

Até 2026-09-28 o [`AGENTS.md`](../AGENTS.md) tinha 57 diretrizes numeradas. Naquele dia ficaram
nele só as de git e as de uso das APIs; as outras saíram de lá **como regra de trabalho**, mas
continuam sendo a explicação de por que o código é como é — e os comentários do código citam os
números delas ("diretriz 56", "diretriz 57").

Este arquivo guarda o texto como estava, para essas referências terem onde apontar. **Não é lista
de regras em vigor**: é o registro das decisões, cada uma com o problema que a motivou. Os números
não se reaproveitam; os que faltam aqui (1–4, 14–24, 29, 43 e 44) estão no `AGENTS.md`, e 34–36,
47 e 48 já não existiam.

Algumas passagens descrevem o estado de 2026-09-28 (a política de RLS, o tamanho do banco);
o código é a fonte da verdade quando os dois discordarem.

## Armazenamento — orçamento de 500 MB

**5. O teto real do banco é 500 MB, não 1 GB.** No Supabase Free, 500 MB é o banco e 1 GB é o
*file storage* (bucket), que é um contador separado. Todo dimensionamento parte de 500 MB.

**6. Não armazenar o que pode ser recalculado ou rebuscado.** Drop rate se calcula de `times/kills`
— guarda-se os dois inteiros, nunca o percentual. Nada de coluna derivada persistida sem motivo
medido.

**7. Nunca gravar payload cru de API no banco.** Guardar JSON de resposta "por garantia" é o jeito
mais rápido de queimar 500 MB. Cache de resposta vive fora do Postgres: ISR/cache da Vercel,
arquivo de build, ou memória do processo.

**8. Nada de binário no Postgres.** Imagens do wiki e do tibia.com já são hospedadas na origem —
guardar a URL ou só o nome da página. Se precisar hospedar, é o bucket de Storage, não o banco.

**9. Tipos estreitos por padrão.** `int4` em vez de `bigint` quando 2,1 bilhões bastam (e bastam
para tudo aqui); `smallint` para contadores pequenos; `date` (4 bytes) quando não precisa de hora;
inteiro de centavos/permilagem em vez de `numeric`. PK `identity` inteira em vez de UUID (4 bytes
contra 16, multiplicado por toda FK que referencia).

Exceção medida: os ids de lookup eram `smallint` e viraram `integer` no `0005`. O teto de 32.767
parecia folgado contra o número de linhas, mas quem gasta id é a sequência, e ela anda muito mais
que as linhas — diretriz 56. O custo foi zero byte: o alinhamento já comia os 2 que o `smallint`
economizava (`pg_column_size` igual antes e depois, em todas as tabelas).

**10. Normalizar strings repetidas em tabelas de lookup.** Nome de item e de criatura se repetem
milhares de vezes em dados de loot; armazenar a string em cada linha é desperdício puro. Linha de
loot referencia `item_id` e `creature_id`, não texto.

**11. Todo índice custa espaço.** Criar índice só para consulta que existe de verdade, preferir
índice parcial/composto ao invés de vários avulsos, e remover o que não for usado.

**12. Toda tabela que cresce com o tempo nasce com política de retenção definida.** Histórico e
séries temporais sem regra de expurgo são o segundo jeito mais rápido de estourar o limite.
Definir a regra no mesmo commit que cria a tabela.

**13. Medir, não estimar.** Antes de qualquer carga em massa, medir com
`pg_size_pretty(pg_total_relation_size('tabela'))` e `pg_database_size(current_database())`, e
registrar o número. Tupla morta conta para o tamanho — considerar `VACUUM` após deleção grande.

**56. `upsert` com `ignoreDuplicates` gasta sequência, mesmo sem gravar linha.** O Postgres calcula
o `default` da coluna — o `nextval` da identity — ANTES de descobrir o conflito, e valor de
sequência não volta. `idsPorNome` mandava todos os nomes de cada importação num `upsert` desses.
Medido em 2026-09-27: `item_id_seq` em **1.179** com **156** itens gravados, ~30 ids por
importação, contra um teto de 32.767 (`smallint`). Dava umas mil importações, somando todas as
contas, até toda importação com item passar a falhar — e uma chamada só ao PostgREST, com 31 mil
nomes repetidos, esgotava tudo de uma vez sem gravar uma linha.

Duas regras:

- **Ler antes de inserir** em tabela de lookup: só vai para o `insert` o que a leitura não achou.
  O `ignoreDuplicates` fica para a corrida entre dois usuários gravando o mesmo nome novo.
- **Dimensionar id pelo consumo da sequência, não pela contagem de linhas.** A conta da diretriz 9
  estava certa para as linhas e errada para o que de fato gasta id.

## Integração com as APIs de Tibia

**52. A NOSSA documentação também envelhece — e o fixture ganha dela.** A diretriz 14 manda não
inferir o formato de resposta de terceiro. Esta diz o mesmo sobre o que nós mesmos escrevemos.

Aconteceu em 2026-09-22. `docs/hunt-analyser.md` e o `AGENTS.md` afirmavam, havia dias, que o Hunt
Analyser escreve item no plural (`great mana potions`) e que faltava um de-para para resolver isso.
**O fixture do próprio repositório desmentia**: `413x a great mana potion` — singular, com artigo,
na quantidade 413. E os 138 itens de 9 sessões reais não têm **nenhum** par singular/plural.

O problema real era outro: a API do wiki é sensível a caixa e não usa Title Case inglês
(`Wand of Inferno` responde 200, `Wand Of Inferno` responde 404).

O que isso custaria se eu tivesse confiado no texto: singularizar antes de consultar transformaria
`steel boots` em `steel boot`, `terra legs` em `terra leg` e `silencer claws` em `silencer claw` —
**nove itens do banco cujo nome É plural**, todos passando a dar 404. O conserto "óbvio" quebraria
o que estava certo, para resolver um problema que não existia.

Duas regras, então:

- Antes de consertar um problema que a documentação descreve, **confirme que ele existe** — no
  fixture, no banco, ou na API.
- Quando a prosa e o dado gravado discordam, o dado gravado vence, e a prosa se corrige no mesmo
  commit. Documentação errada é pior que documentação ausente: a ausente faz você ir olhar.

## Dados

**49. Tabela de lookup é vocabulário COMPARTILHADO, e isso tem duas consequências.**

A primeira é de dados. `monstro`, `item`, `spot` e `personagem` guardam o nome uma vez e todo mundo
referencia o id (diretriz 10). Campo de texto livre que passa por `idsPorNome` faz **`upsert`**:
"Bubble", "bubble" e "Buble" viram três linhas, e os números do mesmo char se espalham entre chars
diferentes — o oposto do que o campo existia para fazer. Por isso o campo de personagem virou
seletor em 22/09, e quem cria personagem agora é só o `/config`, que confere o nome contra a
TibiaData antes. O `spot` continua texto livre **de propósito**: nome de hunt é vocabulário que
cresce com o uso, e não há lista de onde escolher.

A segunda é de segurança, e é a que surpreende. A RLS dessas tabelas é `using (true)`, porque todo
autenticado precisa ler o vocabulário. Logo, **um id de tabela de lookup vindo do cliente NÃO está
protegido pela RLS** — ela não tem como recusar o id do char de outra pessoa. Quem recusa tem de
olhar a tabela de vínculo (`usuario_personagem`). Em 22/09 isso virou uma consulta na server
action, e ela rejeitava o id alheio — medido. **Mas não era fronteira**: o token do usuário grava
em `sessao` direto pelo PostgREST, por fora da action. Desde o `0005` quem recusa é um gatilho no
banco, e a consulta da action ficou só para dar frase — diretriz 57.

Vale para qualquer campo novo em que o cliente mande o id de um lookup. `<select>` no HTML não é
validação: é o cliente falando.

Nada disso é surpresa do schema — o `0001` já anotava, em comentário, o **risco aceito** de um
autenticado poluir os lookups com nomes inventados, e adiava o endurecimento "para quando houver
usuário além de nós". O caso do `personagem` foi fechado por outro caminho, sem `security definer`:
tirando o texto livre, ninguém mais inventa nome. `monstro`, `item` e `spot` continuam abertos, e
continuam sendo risco aceito — só que agora consta aqui, e não só dentro do SQL.

A condição do `0001` já vale: em 2026-09-27 eram **5 contas**. O `0005` não fechou a porta, mas
tirou o que ela deixava fazer de pior: nome ganhou teto de tamanho, e o id deixou de ter um teto
alcançável (diretriz 56). Inventar nome continua possível, e continua risco aceito.

**53. Número medido e número estimado não somam no mesmo total.** Todo número da tela sai do
texto que o jogador colou e pode ser conferido contra ele. Os **drops extras** são a exceção: o
valor é palpite do usuário sobre quanto um rare vale de verdade — útil justamente porque o `Loot`
avalia item por referência de NPC e erra feio aí.

Por isso eles somam **à parte**, e o painel diz "não entram no profit" na cara. Jogar os dois num
total só tornaria o profit inauditável contra o texto de origem, e seria impossível saber, meses
depois, quanto daquele número foi medição e quanto foi chute.

Consequência prática: extra em TC **sem preço configurado** não vale zero, vale
**desconhecido**. `somarExtras` conta esses à parte em `semPreco` e a tela mostra quantos ficaram
de fora — total que esconde parcela é pior que total nenhum.

## Stack e deploy

**25. A stack é Next.js (App Router) + `@tailwindcss/postcss`, via
`npx create-next-app@latest -e with-supabase`.** Decidido em 2026-09-16. **Vite/SPA está
descartado** e o guia de Tailwind com Vite (`@tailwindcss/vite`) **não se aplica** a este projeto.

Motivo decisivo: **`tibiawiki.dev` não envia `Access-Control-Allow-Origin` para origens externas**
(verificado; `api.tibiadata.com` envia `*`). O browser bloqueia a resposta, então um SPA não
alcança a API de loot — o dado central do projeto — sem um proxy de servidor. Com Vite seriam duas
peças para manter em vez de uma.

Reforços: ISR (diretriz 28) e o endpoint invocado pelo cron (diretriz 27) só existem com servidor;
o cache de `fetch` do Next.js atende às diretrizes 7 e 17 sem tocar no Postgres; e a chave
`service_role` do Supabase, necessária para o ETL escrever ignorando RLS, não pode existir em
bundle de browser.

Consequência prática: Tailwind não se instala à mão — o template já traz TypeScript, Tailwind e
auth por cookie configurados. **Atenção: o template entrega Tailwind v3.4.1**, com
`tailwind.config.ts` e `autoprefixer`, não a v4 do guia oficial. Migrar para v4 é opção em aberto,
não pendência.

**26. RLS ligada em toda tabela, desde a criação.** A chave publicável do Supabase roda no browser:
sem Row Level Security a tabela é pública para leitura e escrita. `alter table ... enable row level
security` + políticas explícitas no mesmo migration que cria a tabela. Segredo nunca em
`NEXT_PUBLIC_*`.

**27. ETL periódico cabe em 1 execução diária.** Cron na Vercel Hobby roda **no máximo uma vez por
dia**, com ±59 min de imprecisão, e a função tem teto de 60 s. Job que não couber nisso roda fora
da Vercel — projetar para isso desde o começo, e usá-lo também para manter o projeto Supabase
acordado (pausa após 1 semana de inatividade).

**28. Dado de wiki que muda pouco vai para ISR, não para o banco.** Revalidação por tempo resolve a
maior parte dos casos sem consumir os 500 MB.

**33. `use cache` não é cache confiável em serverless.** A documentação do Next é explícita: com o
handler em memória padrão, "serverless instances are ephemeral, so entries may not be reused between
requests". Na Vercel, um `'use cache'` numa lista externa significaria rebuscá-la a cada
carregamento de página — o oposto da diretriz 17. Para dado que muda raramente (a lista de
criaturas muda só quando o jogo ganha bicho novo), **versionar um arquivo gerado é melhor que
cachear**: custo zero, diff auditável e nenhuma dependência de terceiro no caminho da requisição.
`'use cache: remote'` é durável mas, segundo a própria documentação, "incurs platform fees".

**32. Next.js 16 com Cache Components muda as regras de renderização.** `export const dynamic` foi
removido e **ler `cookies()` fora de um `<Suspense>` é erro de build** — o que inclui todo uso do
cliente Supabase de servidor. O padrão é: shell estático na página, dados do usuário num componente
`async` atrás da fronteira. A documentação da versão instalada está em
`node_modules/next/dist/docs/` e é a fonte a consultar, não a memória.

**51. Migration já aplicada pode ser reescrita — sob duas condições, e MEDINDO.** A regra normal é
que migration é histórico e não se toca: reescrever faz o banco de quem já rodou divergir do de quem
rodar amanhã. Em 2026-09-22 dois arquivos foram fundidos num só assim mesmo, porque as duas
condições valiam: existe **um** banco, e o estado final é **idêntico**.

A segunda não se presume. O schema real foi lido coluna a coluna antes e depois — `perfil` sem a
coluna removida e com `fuso`, `personagem` com os campos que o `0003` acrescentou, `sessao` com
`personagem_id` e `pasta_id`, as funções derrubadas de fato mortas, a view com as colunas certas.
Sem essa leitura é chute com cara de faxina, e o preço aparece meses depois, num banco montado do
zero que não bate com produção.

O que se ganha: um banco novo deixa de criar objeto para derrubá-lo dois arquivos adiante — e o que
se derrubava ali eram funções `security definer` com `grant execute to authenticated`, feitas para
atravessar a RLS de propósito. Código morto que ainda responde é pior que código morto.

## Código

**50. Detalhe de lista se busca ao ABRIR, não junto da lista.** O analyzer de uma sessão mostra
monstros e itens; a sessão medida em 22/09 tinha 4 monstros e **38 itens**, e a tela carrega até 500
sessões. Trazer o detalhe de todas seriam ~20 mil linhas em **toda** visita, para mostrar as de uma
só quando alguém clica.

`app/hunts/detalhe.ts` busca quando pedem, e o componente guarda o que voltou: reabrir não volta ao
banco, porque sessão encerrada não muda. Dado imutável é o caso em que guardar no cliente sai de
graça — não há invalidação para acertar.

**54. `<dialog>` dentro de `<Link>` quebra — e o portal sozinho NÃO conserta.** Em 2026-09-23
descobriu-se que apagar pasta nunca funcionou. `EditarPasta` é renderizado no slot `acao` de
`ItemDaLateral`, **dentro do `<Link>` da pasta**: o `<form>` e o `<dialog>` nasciam dentro de um
`<a href>`. HTML inválido, e pior — clicar em "Apagar pasta" virava navegação. A confirmação
piscava, porque o estado do React atualizava, e a página ia embora antes de dar para confirmar.

O botão de editar disfarçava com `preventDefault`, remendo por botão; ninguém pôs o mesmo no de
apagar.

**O conserto precisa das DUAS metades**, e a segunda surpreende: depois de portar o diálogo para o
`<body>`, o clique **continuava navegando**. Evento do React borbulha pela árvore de
**componentes**, não pela do DOM — o `<Link>` segue sendo ancestral em React mesmo com o
`<dialog>` pendurado no body. Daí o `onClick` do diálogo começar com `stopPropagation`.

Regra: **modal nasce por portal no `<body>`, com `stopPropagation` no próprio diálogo.** Uma
barreira no lugar certo, em vez de um `preventDefault` por botão que alguém vai esquecer no
próximo.

**55. Regex que roda sobre texto colado é superfície de ataque.** Em 2026-09-27 o parser do Hunt
Analyser lia a linha de `Session data` com `^From\s+(.+?)\s+to\s+(.+)$`. Parece inocente, e é
**cúbico**: `.+?` e os dois `\s+` disputam os mesmos espaços, e o motor tenta todas as divisões.
Medido: 2 mil espaços, 0,9 s; 4 mil, 6,7 s; 8 mil, 50 s. Oito KB colados no formulário travavam a
função até o timeout — e, com várias requisições por instância, travavam quem estivesse junto.

Três regras:

- **Formato fixo em vez de "qualquer coisa até o delimitador"**, quando o formato é conhecido. Com
  a data escrita no próprio regex não há ambiguidade: 1 milhão de espaços leva 2,4 ms.
- **Teto de tamanho antes de qualquer regex** — `MAX_TEXTO`, 64 KB, contra 1 a 2 KB de uma sessão
  real.
- **Teste com entrada hostil e teto de tempo** (`lib/hunt.test.ts`), dimensionado para uma
  regressão falhar em segundos em vez de pendurar o teste.

**30. Atribuição obrigatória em qualquer interface pública.** Tibia e produtos relacionados são
© CipSoft GmbH; creditar `tibia.com` (via TibiaData) e o TibiaWiki (via tibiawiki.dev).

**31. Comentários e commits em português**, acompanhando o padrão dos outros repositórios do autor.

**37. As letras da marca são desenhadas, não tipografadas.** `lib/marca.ts` não tem um `<text>`
sequer: cada letra é `<rect>`, `<circle>` ou `<path>`. Não é purismo. O favicon e o cartão social
saem de `sharp`, que rasteriza SVG **fora do navegador** e usa as fontes da máquina de quem rodar o
gerador — texto ali sai diferente em cada máquina, ou não sai. `lib/marca.test.ts` trava isso.

Consequência: `o`, `b` e `a` são um caminho só, contorno externo mais olho, com
`fill-rule="evenodd"`. Anel de traço mais retângulo de haste **não encosta**: com bojo de raio 28 e
haste tangente de 16, os dois só se cruzam em y=47,7, abaixo do topo da altura-x, e sobra um degrau
de fundo de 4,58 — imperceptível em 22 px, escancarado em 1200.

Os arquivos de imagem são versionados e regerados à mão, pelo mesmo motivo da diretriz 33:

```bash
node --experimental-strip-types scripts/gerar-marca.ts
```

## Contas e acesso

**38. Não existe cadastro, e desligar isso no painel faz parte da mudança.** Remover a tela de
`/auth/sign-up` é decoração: o endpoint `POST /auth/v1/signup` do GoTrue continua aceitando quem
souber o caminho. **"Allow new users to sign up" tem de ficar desligado** no painel do Supabase — hoje está, e
foi medido (`422 signup_disabled`), mas quem religar reabre o cadastro sem tocar numa linha de
código. A API de admin, que o script usa, ignora essa trava e continua criando conta normalmente.

**39. `SUPABASE_SECRET_KEY` nunca vai para a Vercel.** Ela ignora a RLS inteira e serve só a
`scripts/criar-usuario.ts`, rodado na máquina do Davi. O site em produção não precisa dela: o
primeiro acesso é um `signInWithPassword` comum e a troca de senha é um `updateUser`, os dois com
a chave publicável. Pôr a secreta em produção aumentaria a superfície sem destravar recurso nenhum.

**Medido em 2026-09-27: a regra acima estava sendo violada, e ninguém tinha visto.** As variáveis de
produção do projeto na Vercel tinham `SUPABASE_SECRET_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
`SUPABASE_JWT_SECRET` e sete `POSTGRES_*` com a senha do banco. Vieram da integração Supabase ↔
Vercel — todas com o mesmo `configurationId` —, que injeta tudo ao conectar. O código de produção lê
só `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, conferido por `grep`.

É a diretriz 52 aplicada à infraestrutura: a prosa dizia "nunca", e ninguém tinha olhado a lista.
Conferir pelos NOMES, sem abrir valor nenhum:

```bash
vercel env ls production
```

Tem de sair só as duas `NEXT_PUBLIC_*`. E integração que sincroniza variável volta a injetá-las
se alguém clicar em "resync": depois de apagar, desligar a sincronização. **Remoção ainda pendente
em 2026-09-28**, e é pelo painel: o MCP da Vercel não tem como apagar variável, e o filtro de
permissões do Claude Code barra escrita em cofre de segredos mesmo com autorização dada no chat.
Atualizar esta linha quando for feita.

**40. `senha_definida` é porteiro de fluxo, não fronteira de segurança.** A flag vive em
`user_metadata`, que o próprio dono consegue gravar — quem quiser vira a flag sem trocar a senha.
O que ele ganha é continuar com uma senha que o Davi mandou por mensagem; não ganha dado de mais
ninguém, porque quem isola continua sendo a RLS. A segurança real está no código de ativação ser
um segredo de ~49 bits sorteado com `crypto.getRandomValues`. Não transformar essa flag em
autorização de coisa alguma.

Desde 2026-09-27 o código também **vence**: `criar-usuario.ts --expirar` troca por uma senha
aleatória a conta que ficou mais de 7 dias no código, pela data gravada em `app_metadata` — que o
usuário, ao contrário do `user_metadata`, não consegue escrever. E trocar a senha chama
`signOut({ scope: "others" })`: se alguém usou o código antes do dono, sai junto.

**41. Transição de autenticação usa navegação DURA, nunca `router.push`.** Login, definir senha e
sair trocam `window.location.assign`. `router.push` é navegação do cliente: serve o que estiver no
Router Cache do Next — inclusive uma cópia pré-buscada enquanto a sessão era outra — e pode não
passar pelo middleware com o cookie recém-gravado. O sintoma é o primeiro acesso exigir vários F5
até "destravar", que é o que aconteceu em 2026-09-21. Uma carga de página inteira por login é
preço barato.

Duas armadilhas irmãs, do mesmo episódio:

- **`updateUser` não reemite o access token.** Depois de trocar a senha, o JWT no cookie ainda diz
  `senha_definida: false` e o middleware devolve o usuário para a tela de senha. Tem de chamar
  `refreshSession()` antes de navegar.
- **O middleware distingue "sem sessão" de "não consegui verificar".** Com chave assimétrica
  (ES256), `getClaims()` busca o JWKS na rede — ~750 ms medidos — e em instância fria isso falha.
  Aí vem `error` preenchido com o cookie ainda válido; tratar como deslogado vira soluço de rede
  em sessão perdida. Sem sessão é `data` e `error` os dois nulos, e só isso manda para o login.

**42. `lib/periodo.ts` não é código morto.** A semana saiu da tela em 2026-09-21 e o outro
consumidor morreu em 22/09. A tentação seguinte é apagar o motor de dia do jogo. **Não apague.**

Ele é quem sabe que **o dia de Tibia vira no server save**, às 10:00 de Berlim. Hoje quem depende
disso é a cidade do Rashid — e sim, é um consumidor só. Não é motivo para apagar: o dia do jogo é
uma regra do domínio, não um detalhe de tela, e ela volta a fazer falta na primeira vez que alguém
perguntar "quanto rendeu hoje".

O Rashid muda de cidade no server save, não à meia-noite. Com `Date.getDay()` ele ficaria errado
**10 horas por dia, todo dia** — às 08:00 de uma terça ele ainda está na cidade de segunda.
`lib/metaRashid.test.ts` trava exatamente esse caso.

A rotação é arquivo versionado e não chamada de API, pelo motivo da diretriz 33: a TibiaData **não
tem endpoint de NPC** (conferido nos 20 caminhos da v4), e sete strings que nunca mudam não
justificam dependência de rede no caminho da requisição. A origem é o TibiaWiki, onde os campos
`city`…`city7` e a prosa de `notes` concordam entre si.

**45. RLS sem política de `update` nega EM SILÊNCIO — e o PostgREST responde sucesso.** Aconteceu
em 2026-09-21: `sessao` tinha select, insert e delete desde o 0001, e nada mais. Mover uma hunt
para uma pasta é `update sessao set pasta_id`; o Postgres não encontrava linha alguma que a
política permitisse tocar, atualizava zero linhas, e a API devolvia **200 sem erro**. A tela não
tinha como saber, e o sintoma era "clico e não acontece nada".

Ao criar tabela ou ao passar a editar uma coluna que ninguém editava, conferir os **quatro** verbos:

```sql
select tablename, cmd, policyname from pg_policies
 where schemaname = 'public' order by tablename, cmd;
```

Toda política de `update` leva `using` **e** `with check`. Só com `using`, eu alcanço a minha
linha e gravo nela o `usuario_id` de outra pessoa.

**46. Regra que vive no Postgres precisa de teste que fale com o Postgres.** Nenhum teste de
`lib/` pegaria a diretriz 45: não há lógica errada, o `tsc` está feliz e a chamada "funciona".
`scripts/testar-pastas.ts` e `scripts/testar-extras.ts` existem para essa classe — eles entram como
usuário de verdade e exercitam a RLS pelo mesmo caminho da tela:

```bash
node --experimental-strip-types --env-file=.env.local scripts/testar-pastas.ts
node --experimental-strip-types --env-file=.env.local scripts/testar-extras.ts
```

Duas regras: ele **relê do banco** em vez de confiar no retorno da chamada — era exatamente o
retorno que mentia —, e **não entra na diretriz 3**, porque precisa de credencial e de rede, e a
lista de validação tem de rodar em qualquer máquina.

Cada um cria duas contas descartáveis (prefixo reservado `zz-teste-`), entra nelas com
`signInWithPassword` pela chave publicável e apaga as duas no fim — `scripts/usuarios-de-teste.ts`.
A chave secreta só cria e apaga as contas; se o teste rodasse com ela, ignoraria a RLS, que é
justamente o que se quer testar.

Até 2026-09-27 eles assinavam um JWT com o segredo HS256 legado. Testava a coisa certa, mas prendia
o projeto a manter verificando uma chave que forja qualquer papel, `service_role` incluso. De
quebra, os testes pararam de mexer nos dados de quem usa o site: antes pegavam a primeira conta
real e moviam uma sessão dela de pasta.

Se precisar saber se a culpa é da RLS, repita a operação com a chave secreta, que a ignora: se
funcionar lá e não logado como usuário, é política faltando.

**57. Server action não é fronteira: o token do usuário fala direto com o PostgREST.** O cookie de
sessão do `@supabase/ssr` é legível pelo JavaScript e a chave publicável é pública, então qualquer
pessoa logada monta a própria chamada ao PostgREST e passa por fora de toda server action. O que a
action confere é **recado para o usuário**; o que protege tem de estar no banco — `check`,
política, gatilho.

Aconteceu duas vezes antes de alguém notar: a checagem de personagem da diretriz 49 e a de pasta
(`lib/posse.ts`) moravam em server actions e eram contornáveis por um `update` direto. Desde o
`0005`, a pasta é conferida no `with check` das políticas de `sessao` e `drop_extra`, e o
personagem, num gatilho.

Por que gatilho no personagem, e não `with check`: o `with check` só enxerga a linha NOVA. O
vínculo com um char pode acabar depois (`removerPersonagem`), e as hunts continuam apontando para
ele; com a regra no `with check` do update, mover uma dessas hunts para uma pasta seria recusado —
e em silêncio, que é a diretriz 45 de novo. O gatilho enxerga `old` e só confere quando o
personagem muda de fato. Vale para toda regra de posse que possa deixar de valer depois de a linha
existir.
