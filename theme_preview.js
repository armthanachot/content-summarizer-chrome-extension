(function (g) {
  'use strict';

  const SUMMARY_MARKDOWN = `# Weekly Product Summary
This is a **curated digest** of what shipped, what slipped, and what needs attention.

## Highlights
- ✅ Search latency improved by **28%**
- 🧪 Rolled out A/B experiment for onboarding CTA
- ⚠️ Billing webhook retries increased in APAC

## Delivery Snapshot
| Area | Status | Owner |
| --- | --- | --- |
| API | On Track | Backend |
| Web UI | At Risk | Frontend |
| QA | Stable | QA Team |

> Note: Keep focus on reducing friction in first-time user flow.

\`\`\`js
const releaseHealth = { score: 86, trend: "up" };
console.log(releaseHealth);
\`\`\`

Read full notes: [internal release board](https://example.com/releases)

---
`;

  const EXPLAIN_MARKDOWN = `# Explain: Why request batching helps
Request batching reduces network overhead by grouping small operations into one payload.

## Benefits
1. Fewer round trips to server
2. Better throughput under load
3. Lower chance of rate-limit spikes

**Rule of thumb:** batch independent reads, avoid batching long-running writes.

\`\`\`txt
single requests: 12 calls x 120ms
batched request: 1 call x 260ms
\`\`\`

> Caveat: very large batches can increase tail latency.
`;

  const CHAT_CONVERSATIONS = [
    {
      id: 'conversation-architecture',
      title: 'Architecture Review',
      messages: [
        {
          role: 'user',
          content: 'ช่วยสรุป risk หลักของ flow นี้หน่อย',
        },
        {
          role: 'assistant',
          content:
            '## Risks\n- Coupling ในไฟล์เดียว\n- State กระจายหลายจุด\n\nแนะนำแยก preview เป็น module เพื่อให้ maintain ง่ายขึ้น',
        },
      ],
    },
    {
      id: 'conversation-theme',
      title: 'Theme Tuning',
      messages: [
        {
          role: 'user',
          content: 'อยากให้ปุ่มเด่นขึ้น แต่ยังคุมโทนเดิม',
        },
        {
          role: 'assistant',
          content:
            'ใช้ gradient จาก header และ text จาก headerText จะคุม identity ได้ดี พร้อมเพิ่ม contrast สำหรับปุ่มหลัก',
        },
      ],
    },
  ];

  function escapeHtml(text) {
    return String(text || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function safeRenderMarkdown(parseMarkdown, text) {
    if (typeof parseMarkdown !== 'function') {
      return `<pre>${escapeHtml(text)}</pre>`;
    }
    return parseMarkdown(text);
  }

  function renderSummarySlide(theme, parseMarkdown) {
    return `
      <section class="theme-preview-surface summary">
        <header class="theme-preview-surface-header" style="background: linear-gradient(135deg, ${theme.summary.headerStart}, ${theme.summary.headerEnd}); color: ${theme.summary.headerText};">
          <span>Content Summarizer</span>
        </header>
        <div class="theme-preview-summary-source">
          <strong>Source:</strong> https://example.com/weekly-product-report
        </div>
        <div class="theme-preview-summary-body" style="background:${theme.summary.summaryPanelBackground}; border-color:${theme.summary.summaryPanelBorder}; color:${theme.summary.summaryMarkdownText};">
          ${safeRenderMarkdown(parseMarkdown, SUMMARY_MARKDOWN)}
        </div>
      </section>
    `;
  }

  function renderExplainSlide(theme, parseMarkdown) {
    return `
      <section class="theme-preview-surface explain" style="background:${theme.explain.panelBackground}; border-color:${theme.explain.borderColor}; color:${theme.explain.bodyText};">
        <header class="theme-preview-surface-header" style="background: linear-gradient(135deg, ${theme.explain.headerStart}, ${theme.explain.headerEnd}); color: ${theme.explain.headerText};">
          <span>Explain</span>
        </header>
        <div class="theme-preview-explain-body">
          ${safeRenderMarkdown(parseMarkdown, EXPLAIN_MARKDOWN)}
        </div>
      </section>
    `;
  }

  function renderChatConversation(theme, parseMarkdown, conversation) {
    const messagesHtml = (conversation.messages || [])
      .map((message) => {
        if (message.role === 'user') {
          return `
            <div class="theme-preview-chat-user-wrap">
              <div class="theme-preview-chat-user" style="background: linear-gradient(135deg, ${theme.chat.messageUserStart}, ${theme.chat.messageUserEnd}); color: ${theme.chat.headerText};">
                ${escapeHtml(message.content)}
              </div>
            </div>
          `;
        }
        return `
          <div class="theme-preview-chat-assistant" style="background:${theme.chat.messageAssistantBackground}; color:${theme.chat.assistantMdParagraph};">
            ${safeRenderMarkdown(parseMarkdown, message.content)}
          </div>
        `;
      })
      .join('');

    return `
      <article class="theme-preview-chat-conversation">
        <h5>${escapeHtml(conversation.title || 'Conversation')}</h5>
        <div class="theme-preview-chat-messages">
          ${messagesHtml}
        </div>
      </article>
    `;
  }

  function renderChatSlide(theme, parseMarkdown) {
    const conversationsHtml = CHAT_CONVERSATIONS.map((item) =>
      renderChatConversation(theme, parseMarkdown, item)
    ).join('');

    return `
      <section class="theme-preview-surface chat" style="background:${theme.chat.panelBackground}; border-color:${theme.chat.borderColor}; color:${theme.chat.textColor};">
        <header class="theme-preview-surface-header" style="background: linear-gradient(135deg, ${theme.chat.headerStart}, ${theme.chat.headerEnd}); color: ${theme.chat.headerText};">
          <span>Chat</span>
        </header>
        <div class="theme-preview-chat-body">
          ${conversationsHtml}
        </div>
      </section>
    `;
  }

  function buildSlides(theme, parseMarkdown) {
    return [
      {
        key: 'summary',
        title: 'Summary Preview',
        html: renderSummarySlide(theme, parseMarkdown),
      },
      {
        key: 'explain',
        title: 'Explain Preview',
        html: renderExplainSlide(theme, parseMarkdown),
      },
      {
        key: 'chat',
        title: 'Chat Preview',
        html: renderChatSlide(theme, parseMarkdown),
      },
    ];
  }

  g.ThemePreview = {
    mock: {
      summaryMarkdown: SUMMARY_MARKDOWN,
      explainMarkdown: EXPLAIN_MARKDOWN,
      chatConversations: CHAT_CONVERSATIONS,
    },
    buildSlides,
  };
})(globalThis);
