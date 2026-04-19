(function (g) {
  'use strict';

  const SUMMARY_MARKDOWN = `เมื่อวันที่ 17 เมษายน 2026 เลขาธิการพาณิชย์ **Howard Lutnick** ระบุว่าประธานาธิบดี **Trump** มองว่าข้อตกลงการค้า **USMCA** กับแคนาดาและเม็กซิโกเป็นข้อตกลงที่ไม่ดีและจำเป็นต้องได้รับการพิจารณาใหม่

## มุมมองของฝ่ายบริหาร Trump ต่อ USMCA
*   **Howard Lutnick** เลขาธิการพาณิชย์ กล่าวว่าประธานาธิบดี **Trump** ถือว่าสนธิสัญญาการค้า **USMCA** ปัจจุบันเป็นข้อตกลงที่แย่และจำเป็นต้องได้รับการ "**พิจารณาใหม่และจินตนาการใหม่**"
*   **Lutnick** วิพากษ์วิจารณ์ว่าการปฏิบัติต่อ **เม็กซิโก** และ **แคนาดา** เหมือนกับรัฐในสหรัฐฯ อย่าง **จอร์เจีย** และ **แอละแบมา** โดยที่พวกเขาไม่ได้ให้คำมั่นสัญญาอย่างเต็มที่นั้นเป็น "การค้าที่ไม่ดี"
*   แม้จะมีข้อดีอยู่บ้าง แต่ก็มีข้อเสียจำนวนมากที่ต้องได้รับการพิจารณาใหม่เพื่อประโยชน์ของ **สหรัฐฯ**

## ความกังวลและผลกระทบ
*   สนธิสัญญา **USMCA** มีกำหนดการทบทวนอย่างเป็นทางการในอีกไม่กี่เดือนข้างหน้า และเจ้าหน้าที่ฝ่ายบริหาร **Trump** คาดว่าจะพยายามเปลี่ยนแปลงข้อตกลง
*   ความไม่แน่นอนเกี่ยวกับข้อตกลงการค้า ซึ่งอนุญาตให้สินค้าส่งออกส่วนใหญ่ของ **แคนาดา** เข้าสู่ **สหรัฐฯ** โดยปลอดภาษี ได้ส่งผลกระทบต่อแผนการลงทุนและการจ้างงานในหมู่ธุรกิจต่างๆ

## ความคืบหน้าในการเจรจา
*   ตัวแทนของ **Dominic LeBlanc** รัฐมนตรีของ **แคนาดา** ที่รับผิดชอบการเจรจา **USMCA** ยังไม่ได้ตอบกลับคำขอความคิดเห็นเกี่ยวกับข้อสังเกตของ **Lutnick** ทันที
*   เมื่อสัปดาห์ที่แล้ว **Jamieson Greer** ผู้แทนการค้าของ **สหรัฐฯ** กล่าวว่าฝ่ายบริหาร **Trump** มีความคืบหน้าในการเจรจากับ **เม็กซิโก** แต่ยังมี "ปัญหาบางอย่าง" กับ **แคนาดา** ที่ยังไม่ได้รับการแก้ไข

\`\`\`text
USMCA review timeline (example)
Canada / Mexico / US — next formal review window
\`\`\`
`;

  const EXPLAIN_MARKDOWN = `**USMCA** ย่อมาจาก **United States-Mexico-Canada Agreement** หรือในภาษาไทยคือ **ข้อตกลงสหรัฐฯ-เม็กซิโก-แคนาดา**

ในบริบทของสรุปนี้ **USMCA** คือ:

*   **ข้อตกลงการค้า**: เป็นสนธิสัญญาการค้าระหว่างสามประเทศ ได้แก่ สหรัฐอเมริกา เม็กซิโก และแคนาดา ซึ่งกำหนดกฎเกณฑ์และเงื่อนไขสำหรับการค้าสินค้าและบริการระหว่างกัน
*   **ประเด็นสำคัญที่ถูกพิจารณา**: ในสรุปนี้ **USMCA** เป็นหัวข้อหลักที่ถูกกล่าวถึง เนื่องจากประธานาธิบดี Trump มองว่าเป็น "ข้อตกลงที่ไม่ดี" และต้องการให้มีการ "พิจารณาใหม่และจินตนาการใหม่" เพื่อผลประโยชน์ของสหรัฐฯ
*   **ผลกระทบต่อธุรกิจ**: ข้อตกลงนี้มีความสำคัญอย่างยิ่งต่อธุรกิจในภูมิภาค เพราะอนุญาตให้สินค้าส่งออกส่วนใหญ่ของแคนาดาเข้าสู่สหรัฐฯ โดยปลอดภาษี ซึ่งความไม่แน่นอนเกี่ยวกับการเปลี่ยนแปลงข้อตกลงนี้ได้ส่งผลกระทบต่อแผนการลงทุนและการจ้างงานของภาคธุรกิจ
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

  function renderSummarySlide(theme) {
    const { escapeHtml, parseMarkdown } = g.Md;
    return `
      <section class="theme-preview-surface summary">
        <header class="theme-preview-surface-header" style="background: linear-gradient(135deg, ${theme.summary.headerStart}, ${theme.summary.headerEnd}); color: ${theme.summary.headerText};">
          <span>Content Summarizer</span>
        </header>
        <div class="theme-preview-summary-source">
          <strong>Source:</strong> ${escapeHtml('https://example.com/weekly-product-report')}
        </div>
        <div class="theme-preview-summary-body" style="background:${theme.summary.summaryPanelBackground}; border-color:${theme.summary.summaryPanelBorder}; color:${theme.summary.summaryMarkdownText};">
          ${parseMarkdown(SUMMARY_MARKDOWN)}
        </div>
      </section>
    `;
  }

  function renderExplainSlide(theme) {
    const { parseMarkdown } = g.Md;
    return `
      <section class="theme-preview-surface explain" style="background:${theme.explain.panelBackground}; border-color:${theme.explain.borderColor}; color:${theme.explain.bodyText};">
        <header class="theme-preview-surface-header" style="background: linear-gradient(135deg, ${theme.explain.headerStart}, ${theme.explain.headerEnd}); color: ${theme.explain.headerText};">
          <span>Explain</span>
        </header>
        <div class="theme-preview-explain-body">
          ${parseMarkdown(EXPLAIN_MARKDOWN)}
        </div>
      </section>
    `;
  }

  function renderChatConversation(theme, conversation) {
    const { escapeHtml, parseMarkdown } = g.Md;
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
            ${parseMarkdown(message.content)}
          </div>
        `;
      })
      .join('');

    return `
      <article class="theme-preview-chat-conversation">
        <h5>${g.Md.escapeHtml(conversation.title || 'Conversation')}</h5>
        <div class="theme-preview-chat-messages">
          ${messagesHtml}
        </div>
      </article>
    `;
  }

  function renderChatSlide(theme) {
    const conversationsHtml = CHAT_CONVERSATIONS.map((item) =>
      renderChatConversation(theme, item)
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

  function buildSlides(theme) {
    return [
      {
        key: 'summary',
        title: 'Summary Preview',
        html: renderSummarySlide(theme),
      },
      {
        key: 'explain',
        title: 'Explain Preview',
        html: renderExplainSlide(theme),
      },
      {
        key: 'chat',
        title: 'Chat Preview',
        html: renderChatSlide(theme),
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
