import type { Topic } from './types'

// 示例内容，人写的，不是模型输出。
// 「重新留意每天经过的地方」在第 0 条和第 5 条各出现一次，用来检查引用能否分清。

export const observation: Topic = {
  key: 'observation',
  title: '重新留意每天经过的地方',
  steps: [
    {
      input: '我想让大家重新留意每天经过的地方，但不想再做一本城市指南。',
      voice:
        '指南给的是去哪里。你想要的更像是回到已经去过的地方。\n\n有没有哪一次，你在一条走熟的路上忽然看见了什么？',
      confidence: 0.55,
      groundwork: {
        prose:
          '我想让人重新留意每天经过的地方。城市指南那种形式我不做，换成什么还没有答案。',
        claims: [
          { text: '要做的事，是让人重新留意每天经过的地方。', status: 'confirmed', from: [0] },
          { text: '城市指南这种形式被排除。', status: 'confirmed', from: [0] },
        ],
        sense: { certainty: 0.35, resonance: 0.5, clarity: 0.25 },
        open: ['换成什么形式，现在没有答案。'],
      },
    },
    {
      input: '下雨以后，我注意到楼道里的反光；那里走过很多次了。',
      voice:
        '走过很多次是关键。不是新地方给了新东西，是同一个地方在某个条件下才显出来——雨、光、时间，都是这种条件。\n\n照这么说，要收集的也许不是地点，而是**让地方显出来的条件**。',
      confidence: 0.7,
      groundwork: {
        prose:
          '我想让人重新留意每天经过的地方。让我自己有这种感觉的是雨后楼道的反光：同一个走熟的地方，在某个条件下才显出来。所以我现在倾向于收集条件，而不是收集地点。这一步还只是倾向。',
        claims: [
          { text: '要做的事，是让人重新留意每天经过的地方。', status: 'confirmed', from: [0] },
          { text: '城市指南这种形式被排除。', status: 'confirmed', from: [0] },
          {
            text: '走熟的地方在特定条件下才显出来——雨后楼道的反光是我自己的例子。',
            status: 'confirmed',
            from: [2],
          },
          {
            text: '要收集的可能是让地方显出来的条件，而不是地点本身。',
            status: 'tentative',
            from: [3],
          },
        ],
        sense: { certainty: 0.5, resonance: 0.6, clarity: 0.4 },
        open: ['条件具体怎么被记下来，还没想。'],
      },
    },
    {
      input: '也不想教别人怎么看，有时一张照片就够了。',
      voice:
        '照片也在教。取景决定了画面里留下什么、切掉什么，构图仍然在引导观看。\n\n不过引导不等于规定。要让人重新留意每天经过的地方，总得有人先把镜头对准某处；问题是对准之后，说不说「你该看这里」。',
      confidence: 0.6,
      groundwork: {
        prose:
          '我想让人重新留意每天经过的地方，收集的可能是让地方显出来的条件。我不想教别人怎么看，但照片的构图本身就在引导观看——所以要分的不是引导与不引导，而是提供观看入口与规定观看答案。这两者的界线落在配文上，我还没决定。',
        claims: [
          { text: '要做的事，是让人重新留意每天经过的地方。', status: 'confirmed', from: [0] },
          { text: '城市指南这种形式被排除。', status: 'confirmed', from: [0] },
          {
            text: '走熟的地方在特定条件下才显出来——雨后楼道的反光是我自己的例子。',
            status: 'confirmed',
            from: [2],
          },
          {
            text: '要收集的可能是让地方显出来的条件，而不是地点本身。',
            status: 'tentative',
            from: [3],
          },
          {
            text: '照片的构图本身在引导观看，不存在不引导的呈现。',
            status: 'tentative',
            from: [5],
          },
        ],
        sense: { certainty: 0.55, resonance: 0.6, clarity: 0.45 },
        open: ['提供观看入口与规定观看答案，界线落在配文的哪一处？'],
      },
    },
    {
      input: '我接受构图的引导，但不想给出“标准答案”；Brief 里应保留这一区别。',
      voice:
        '那这一条可以定下来：**引导可以，标准答案不行**。\n\n接下来是配文的度。只给地点与时间有时候太少——同一个楼道，雨后和雨前是两回事，不写「雨后」，看的人可能对不上。所以未必是写不写的问题，而是写条件还是写结论。',
      confidence: 0.85,
      groundwork: {
        prose:
          '我想让人重新留意每天经过的地方，收集的是让地方显出来的条件。构图必然引导观看，这一点我接受；不接受的是给出标准答案。配文因此不是写与不写的问题，而是写条件还是写结论——我倾向写条件，还没定。',
        claims: [
          { text: '要做的事，是让人重新留意每天经过的地方。', status: 'confirmed', from: [0] },
          { text: '城市指南这种形式被排除。', status: 'confirmed', from: [0] },
          {
            text: '走熟的地方在特定条件下才显出来——雨后楼道的反光是我自己的例子。',
            status: 'confirmed',
            from: [2],
          },
          {
            text: '要收集的是让地方显出来的条件，而不是地点本身。',
            status: 'confirmed',
            from: [3, 6],
          },
          {
            text: '构图的引导可以接受，给出标准答案不行。',
            status: 'confirmed',
            from: [6],
          },
          {
            text: '配文写条件而不写结论。',
            status: 'tentative',
            from: [7],
          },
        ],
        sense: { certainty: 0.7, resonance: 0.7, clarity: 0.6 },
        open: ['照片与文字怎么配合，还没有确定的做法。'],
      },
    },
    {
      input: '不要把照片里的居民变成猎奇对象。',
      voice:
        '这是一条边界，不是偏好——它会否掉一批取景方式：把人拍成景观的，把旧和破当成风味的。\n\n跟前面那条合起来：镜头对准一个地方可以，对准一个人的生活状态不行，除非那个人自己参与。',
      confidence: 0.75,
      groundwork: {
        prose:
          '我想让人重新留意每天经过的地方，收集的是让地方显出来的条件。构图的引导可以接受，标准答案不行，配文倾向写条件不写结论。还有一条边界：不把照片里的居民变成猎奇对象——镜头可以对准一个地方，对准一个人的生活状态需要那个人自己参与。照片与文字如何配合，仍未决定。',
        claims: [
          { text: '要做的事，是让人重新留意每天经过的地方。', status: 'confirmed', from: [0] },
          { text: '城市指南这种形式被排除。', status: 'confirmed', from: [0] },
          {
            text: '走熟的地方在特定条件下才显出来——雨后楼道的反光是我自己的例子。',
            status: 'confirmed',
            from: [2],
          },
          {
            text: '要收集的是让地方显出来的条件，而不是地点本身。',
            status: 'confirmed',
            from: [3, 6],
          },
          {
            text: '构图的引导可以接受，给出标准答案不行。',
            status: 'confirmed',
            from: [6],
          },
          { text: '配文写条件而不写结论。', status: 'tentative', from: [7] },
          {
            text: '不把照片里的居民变成猎奇对象；拍到人需要那个人自己参与。',
            status: 'confirmed',
            from: [8],
          },
        ],
        sense: { certainty: 0.7, resonance: 0.75, clarity: 0.65 },
        open: ['照片与文字怎么配合，还没有确定的做法。'],
      },
    },
  ],
}
