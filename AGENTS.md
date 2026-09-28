# lootibia — diretrizes de trabalho

Projeto em Tibia apoiado em três fontes públicas: **TibiaData API** (dados vivos do jogo),
**TibiaWikiApi / tibiawiki.dev** (dados estáticos do wiki) e o **TibiaWiki** por trás dela.
Stack: **Next.js 16 (App Router, Cache Components)** + **Supabase Free** + **Vercel Hobby** +
**Tailwind v3 via PostCSS**.

Referências técnicas verificadas:
- [docs/tibia-apis.md](docs/tibia-apis.md) — shapes reais, TTLs e armadilhas das duas APIs.
- [docs/stack.md](docs/stack.md) — limites reais dos planos gratuitos, Supabase+Next.js, RLS, Tailwind.
- [docs/hunt-analyser.md](docs/hunt-analyser.md) — formato do Hunt Analyser e dimensionamento.
- [docs/periodos.md](docs/periodos.md) — dia e semana do jogo (server save).

**Número de diretriz não se reaproveita.** Diretriz removida deixa buraco na sequência, para que uma
referência antiga, num commit ou num comentário, nunca aponte para uma regra diferente da que ela
citava. Em 2026-09-28 o Davi removeu todas as diretrizes restritivas, ficando só as de git e as de
uso das APIs; o texto das removidas continua no histórico do git (`git show e875f20:AGENTS.md`).

## Escopo

O lootibia existe para substituir as planilhas de farm e os caderninhos: o jogador guarda e
organiza as hunts dele, ligadas à conta.

**1º — Analisador de Hunts.** O usuário cola o texto que o Hunt Analyser do Tibia copia, o app
parseia, guarda a sessão e mostra os acumulados por pasta: profit e loot, XP e XP Raw, supplies,
médias por hora, mobs mortos e hunts mais caçadas.

**2º — Ferramentas.** Depois do núcleo, uma caixa de ferramentas: calculadoras, scanner de stash,
previsão de level e afins. Têm preferência as que usam os dados que a conta já tem (XP/h e
profit/h reais, personagens), porque é isso que as diferencia de uma calculadora genérica.

Como o app calcula:

- **Toda taxa é `Σ total / Σ horas`, e não a média das médias por sessão.** Uma hunt de 10 min com
  XP/h inflado pesaria igual a uma de 4 h. No caso testado a diferença é de 120 mil/h contra 350 mil/h.
- **`Balance` e as taxas `/h` do texto não são gravadas.** `Balance` é `Loot − Supplies`; os `/h` do
  jogo não são reproduzíveis por nenhuma duração única e servem só para diagnóstico.

## Estado

App no ar em <https://lootibia.vercel.app>. As seis migrations de `supabase/migrations/` estão
aplicadas em produção (a `0005` e a `0006` em 2026-09-28).

- **Contas:** login por usuário e senha desde 2026-09-19, sem cadastro. O Davi cria as contas com
  `scripts/criar-usuario.ts`, que sorteia um código de ativação; o site obriga a trocar a senha no
  primeiro acesso. Modelo em [lib/conta.ts](lib/conta.ts).
- **Lateral:** mora no layout de `app/(app)/` (grupo de rotas, fora da URL) e aparece em toda
  página logada, em três grupos recolhíveis: **Analyzers** (todas as hunts, pastas, adicionar nova
  hunt), **Ferramentas** (Stash analyzer) e **Calculadoras**
  ([components/lateral.tsx](components/lateral.tsx)).
- **Hunts:** `/hunts` lista, apaga, organiza em pastas com meta opcional em TC ou gp
  ([lib/meta.ts](lib/meta.ts)) e mostra os acumulados com sprites de criatura. Cada sessão abre um
  analyzer ([components/analyzer.tsx](components/analyzer.tsx)). A importação é uma janela
  ([components/importar-hunt.tsx](components/importar-hunt.tsx)), aberta pela lateral ou pelo topo.
- **Personagens:** cadastrados em `/config`, conferidos contra a TibiaData. Mundo, vocação e level
  ficam em `usuario_personagem`.
- **Drops extras:** rare anotado com o valor que o usuário dá, somado à parte do profit
  ([lib/extras.ts](lib/extras.ts)).
- **Stash analyzer:** `/ferramentas/stash` lê prints do Supply Stash no navegador — o print não
  sai da máquina — e diz o que serve para Delivery Task (com o mínimo e o máximo que a task pede),
  para imbuement e quanto vale no NPC. Motor em [lib/stash.ts](lib/stash.ts), geometria e fonte
  medidas em `test/fixtures/stash/`. Base e atlas gerados por
  `node --experimental-strip-types scripts/atualizar-stash.ts`, que lê os sprites do **cliente do
  Tibia instalado** (precisa do `xz`) e os dados do TibiaWiki: os CDNs de imagem dos dois wikis
  barram script com a Cloudflare. Ler os arquivos do cliente pode esbarrar no contrato de serviço
  da CipSoft; foi decisão do Davi em 2026-09-28. A janela é achada pelo título "Stash" em qualquer
  posição e tamanho de tela, a 100% ou 200% (ampliação sem suavizar); a altura da lista é medida no
  print; linha cortada pela rolagem é lida pela parte à vista (60% do sprite) e a quantidade, só
  com o número inteiro. Limites: escala fracionária (125%, 150%) e print comprimido (JPEG) não são
  lidos, e os dígitos 7 e 8 ainda não foram vistos num print (viram "?").
- **Calculadoras:** `/calculadoras/level` prevê quando o char chega a um level pelo XP/h real das
  hunts dele ([lib/level.ts](lib/level.ts)). Nasceu em `/ferramentas/level`, que redireciona.
- **Dia do jogo:** [lib/periodo.ts](lib/periodo.ts) sabe a que dia de Tibia um instante pertence (o
  dia vira no server save, 10:00 de Berlim). A rotação do Rashid ([lib/rashid.ts](lib/rashid.ts))
  depende dele.
- **Marca:** wordmark desenhado em vetor em [lib/marca.ts](lib/marca.ts); as imagens saem de
  `node --experimental-strip-types scripts/gerar-marca.ts`.

**Pendente, e é do Davi:**

- rodar `scripts/testar-pastas.ts` e `scripts/testar-extras.ts` (precisam da chave secreta do
  `.env.local`);
- no painel da Vercel, apagar as variáveis que o código não lê (o código só lê
  `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`) e desligar a sincronização da
  integração;
- no painel do Supabase, desligar as chaves de API legadas, revogar o segredo JWT legado e pôr o
  tamanho mínimo de senha no Auth.

---

## Git e validação

**1. `git commit`, `git push` e `git pull` só com aprovação explícita do Davi, e só depois dos
testes de validação passarem.** Sem exceção, sem "commit rápido". Nunca encadear commit e push na
mesma ação sem que cada um tenha sido pedido.

**2. Ordem obrigatória antes de pedir aprovação:** rodar a validação → mostrar o resultado real →
mostrar o que será commitado (`git status` + `git diff`) → pedir aprovação → só então executar.
Se a validação falhar, reportar a falha com a saída; não pedir aprovação de código quebrado.

**3. "Testes de validação" são estes comandos**, nesta ordem, todos passando:

```bash
npx tsc --noEmit
npx eslint .
npm run build
node --experimental-strip-types lib/periodo.test.ts
node --experimental-strip-types lib/hunt.test.ts
node --experimental-strip-types lib/sprites.test.ts
node --experimental-strip-types lib/marca.test.ts
node --experimental-strip-types lib/conta.test.ts
node --experimental-strip-types lib/metaRashid.test.ts
node --experimental-strip-types lib/moedas.test.ts
node --experimental-strip-types lib/nomesDeItem.test.ts
node --experimental-strip-types lib/extras.test.ts
node --experimental-strip-types lib/level.test.ts
node --experimental-strip-types lib/stash.test.ts
```

Conforme o projeto crescer, esta lista cresce junto — mantê-la atualizada aqui.

**4. Nunca commitar na branch principal direto**, nunca usar `--no-verify`, nunca `push --force`,
e nunca reescrever histórico já publicado sem pedido explícito.

---

## Integração com as APIs de Tibia

**14. Nunca inferir o formato de uma resposta.** Consultar `docs/tibia-apis.md` ou fazer a chamada
real. As duas APIs divergem do que a documentação delas promete, e a TibiaWikiApi não tem contrato
estável — ela espelha templates de wiki que mudam sem aviso.

A API do wiki é sensível a caixa e não usa Title Case inglês: `Wand of Inferno` responde 200,
`Wand Of Inferno` responde 404. O de-para está em [lib/nomesDeItem.ts](lib/nomesDeItem.ts). O Hunt
Analyser escreve item no singular com artigo (`413x a great mana potion`), e há itens cujo nome
é plural (`steel boots`, `terra legs`) — não singularizar.

**15. Todo acesso passa por uma camada de cliente única, por API.** Nenhum `fetch` solto espalhado
pelo código. Cada cliente concentra URL base, `User-Agent` identificável, timeout, retry, cache e
normalização. Hoje são [lib/tibiadata.ts](lib/tibiadata.ts) e [lib/tibiawiki.ts](lib/tibiawiki.ts).
A lista de criaturas é um arquivo versionado (`lib/dados/criaturas.ts`), regerado à mão por
`scripts/atualizar-criaturas.ts`.

**16. Nunca confiar apenas no status HTTP.** TibiaData devolve `502 text/plain` para recurso
inexistente (não 404) e `400` com JSON válido para erro de validação — a verdade está em
`information.status.error`. TibiaWikiApi devolve `404` com corpo vazio. Parsear defensivamente.

**17. Respeitar os TTLs reais como piso do cache local** (60 s a 900 s na TibiaData; 60 s na
TibiaWikiApi — tabela em `docs/tibia-apis.md`). Cachear menos que isso só gera tráfego sem dado novo.

**18. Concorrência baixa contra tibiawiki.dev**: pool de 2 threads e fila de 32 do outro lado
(`503` quando enche). Máximo de 2–3 requisições simultâneas, com backoff. Carga em massa é **job
offline**, nunca requisição de usuário.

**19. Nada de `?expand=true` em categorias grandes** — teto de 5.000 páginas; `items` já estoura
(6.560 → `413`).

**20. Somente leitura.** A TibiaWikiApi expõe `PUT` para editar o wiki; está desabilitado na
instância pública e fora do escopo deste projeto.

**21. Normalizar na borda, tipar no domínio.** A TibiaWikiApi devolve tudo como string, com markup
de wiki embutido (`[[Link]]`, `{{Template|...}}`, `"--"` como vazio). Parsers dedicados convertem
no ponto de entrada; o resto do código nunca vê string crua de wiki. Campo ausente é normal, não erro.

**22. Loot stats são amostra de jogadores, não verdade oficial.** Sempre exibir `kills` junto de
qualquer porcentagem. `"Empty"` é kills sem loot: excluir de rankings de item.

**23. Junção entre as duas APIs exige mapeamento explícito.** TibiaData usa slug de `race`
(`dragon`), o wiki usa título de página (`Dragon`). Manter tabela de mapeamento versionada, com
fallback e teste para os nomes que divergem.

**24. Preço de Market não existe em nenhuma das duas APIs** — só `npcvalue`/`value` do wiki, que é
referência de NPC. Não inventar número e apresentar como preço.

**29. Testes contra fixtures gravadas, nunca contra a API ao vivo.** Respostas reais em
`test/fixtures/`, parsers testados contra elas. Um script separado revalida as fixtures contra a
API de verdade, rodado sob demanda.

**43. A TibiaData tem QUATRO formatos de resposta, não um.** A tabela está no topo de
`lib/tibiadata.ts`, e três dos quatro só apareceram batendo na API de verdade:

| Caso | HTTP | Corpo |
|---|---|---|
| achou | 200 | envelope, `information.status.http_code = 200` |
| personagem não existe | **502** | `error code: 502` em **texto puro**, sem envelope |
| nome inválido | 422 | `{"message":"…"}` em JSON, sem envelope |
| mundo não existe | 200 | envelope com `status.error = 11002` |

"Não existe" é **resposta**, não falha: devolver `null`, nunca lançar. Tratar o 502 como erro faz
"personagem não encontrado" virar "a TibiaData está fora do ar", e o usuário vai conferir a
conexão em vez do nome que digitou.

**44. Boostado do dia e gente online são buscados PELO NAVEGADOR.** Mudam rápido demais para
virar arquivo versionado e com frequência demais para o servidor rebuscar a cada requisição
(diretriz 17). A TibiaData responde `Access-Control-Allow-Origin: *` — verificado —, então o
navegador busca direto, o cache HTTP dele respeita o `max-age` que a API manda, e o nosso servidor
não entra na conta. Busca de personagem é o oposto: acontece uma vez, numa ação de usuário, e por
isso roda no servidor. A `tibiawiki.dev` **não** manda CORS: ela só pode ser chamada do servidor.
