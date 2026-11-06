# Arquitetura

```
 ┌──────────────┐  leituras com RLS (anon key + JWT)   ┌───────────────────────────┐
 │  App Expo    │ ───────────────────────────────────▶ │ Supabase                  │
 │ iOS/Android/ │                                       │  Postgres + pgvector      │
 │     web      │ ── escritas moderadas / IA (SSE) ──┐  │  Auth · Storage (media/chat)│
 └──────────────┘                                    │  └─────────────▲─────────────┘
                                                     ▼                │ service role
                                          ┌─────────────────────┐     │
                                          │  Vibuzz API (Fastify)│─────┘
                                          │  Intelligence Engine │──▶ Anthropic / OpenAI / compatível
                                          │  Memory · Vision     │
                                          │  Moderation · Worker │
                                          └─────────────────────┘
```

**Regra de ouro:** o app lê direto do banco o que é dele ou público (RLS decide). Tudo que precisa de IA, moderação ou regra de negócio passa pela API, que usa a service role. Chaves de IA e service role nunca saem do servidor.

## Módulos da API

| Módulo | Pasta | Responsabilidade |
|---|---|---|
| Authentication | `app.ts` | Valida o JWT do Supabase em cada requisição (cache de 60 s) |
| AI providers | `modules/ai` | Camada independente: Anthropic, OpenAI e qualquer API compatível; cadeias de fallback por nível; custo, latência e erros em `usage_records`; remove parâmetros que um modelo não aceita |
| Intelligence Engine | `modules/intelligence` | Monta o contexto de cada resposta, escolhe o nível, faz streaming, orquestra grupos, rastreia a cena |
| Memory Engine | `modules/memory` | Consolidação, deduplicação, recuperação híbrida, resumos, invalidação |
| Image Understanding | `modules/vision` | Análise estruturada: tipo de imagem, sujeitos separados, só traços visíveis |
| Character Creator | `modules/creator` | Ficha a partir de ideia + imagens; regenerar um campo |
| Characters / Groups | `modules/characters` | Criação, versões, tags, imagens, integrantes, embeddings para recomendação |
| Conversations / Messages | `modules/conversations` | Enviar, regenerar, continuar, editar, ramificar, apagar, limites diários |
| Moderation | `modules/moderation` | Texto e imagem; rigor depende de onde o conteúdo aparece |
| Jobs | `modules/jobs` | Fila no Postgres (`claim_jobs` com `SKIP LOCKED`), retentativas com backoff |

Discovery, Social, Profiles, Personas, Notifications e Relationships são lidos/escritos pelo app com RLS e funções SQL (`discover_characters`, `recommend_characters`, `creator_stats`, gatilhos de contadores e notificações).

## Uma resposta, passo a passo

1. App envia `POST /v1/conversations/:id/messages` (texto + caminhos de imagens já enviadas ao bucket `chat`).
2. API confere conta, idade, bloqueio, limite diário; modera texto (chat privado só bloqueia limites rígidos) e imagens; a visão gera uma descrição estruturada de cada imagem.
3. Salva a mensagem do usuário como filha da folha ativa (as mensagens formam uma **árvore**).
4. **Engine:**
   - carrega ficha do personagem (versão atual), persona escolhida, caminho ativo da árvore;
   - grupos: um modelo rápido decide **quem fala, em que ordem e com que intenção** (no máx. N por turno);
   - para cada falante: recupera memórias (só as que ele pode saber e cujas mensagens de origem estão no caminho atual), relações, resumos, cena, mensagens fixadas;
   - monta o prompt: parte **estável** (regras + ficha, cacheada) e parte **dinâmica** (persona, cena, memórias…); todo texto de usuário fica dentro de tags e é sanitizado contra injeção;
   - escolhe o nível (avançado; especializado para grupos grandes ou mensagens longas) e faz streaming via SSE.
5. Ao terminar, enfileira: atualizar cena e relações, consolidar memória, resumir.

## Memória

- **Consolidação** (assíncrona, em lotes): o modelo recebe mensagens novas + memórias existentes relacionadas e devolve `create` / `update` / `supersede`. Cada memória guarda **de quais mensagens veio** (`memory_sources`). Duplicatas são detectadas por similaridade de embedding (≥ 0,92) ou sobreposição de palavras sem embeddings.
- **7 categorias:** episódica, pessoal, emocional, social, narrativa, preferências, curto prazo; com importância e confiança.
- **Recuperação:** `match_memories` combina similaridade semântica, texto, importância e recência; `core_memories` traz sempre o que é muito importante. Nunca carrega o histórico inteiro.
- **Resumos incrementais:** trechos antigos (fora das últimas ~24 mensagens) viram resumos encadeados.
- **Escopo:** memórias são por conversa (um personagem público tem a mesma personalidade para todos, mas lembranças separadas por usuário). Em grupos, `holder_character_id` restringe uma memória ao integrante que soube dela.
- **Ramificações:** como cada memória aponta para suas mensagens, uma ramificação nunca “lembra” o que só aconteceu em outra.
- **Exclusão:** ao apagar uma mensagem, memórias que dependiam só dela são invalidadas (ou apagadas, no modo definitivo); as que têm outras fontes são reconstruídas a partir do que restou; resumos que a incluíam são refeitos; eventos de relação dela somem.

## Edição e ramificações

- **Nova ramificação:** cria uma irmã da mensagem editada; a original continua acessível pelo seletor ‹ 1/2 ›.
- **Substituir:** a mensagem e todo o seu ramo saem do histórico ativo e as memórias derivadas são invalidadas — mensagens posteriores não contradizem a nova versão.
- **Regenerar:** cria outra resposta irmã. **Continuar:** estende a última resposta.
- Mensagens removidas do histórico ficam ocultas para app e IA e são apagadas de vez depois de `MESSAGE_PURGE_DAYS`.

## Cena e relações

Depois de cada turno, um modelo rápido atualiza o estado narrativo (local, presentes, objetivos, objetos e quem os tem, perigos, situação, eventos recentes) e registra **eventos** de relação (amizade, confiança, rivalidade… com descrição do estado), cada um ligado à mensagem que o causou. Não há “barra numérica”: o estado é texto ancorado em acontecimentos, e cada ramificação tem o seu.

## Segurança

- RLS em todas as tabelas; tabelas sensíveis só aceitam escrita da API; colunas que o dono pode mudar direto são liberadas uma a uma (`grant update (...)`).
- Fichas completas (com instruções do criador) só são legíveis pelo criador; o público vê o card.
- Idade: 13+ no cadastro (verificado no gatilho do banco); 18+ exige maioridade **e** opção explícita; personagens menores nunca podem ter romance/18+; regras de idade entram no prompt.
- Moderação por contexto (`decide()`): chat privado bloqueia só limites rígidos e detecta crise; fichas públicas, perfis e comentários são mais rígidos; imagens no bucket público são sempre checadas.
- Limites: por minuto (Fastify rate limit, Redis opcional) e diários (mensagens e custo).
- Exclusão de conta apaga arquivos e, por cascata, todos os dados.

## Personagens com vida própria (futuro)

A base já existe: preferência `users.spontaneous_messages` (desligada por padrão), fila de jobs com agendamento (`run_at`), notificações. Um job periódico poderá gerar acontecimentos narrativos e mensagens espontâneas **apenas** para quem ativou a opção.
