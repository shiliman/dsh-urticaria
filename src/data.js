export const DATA = {
  id: 'dsh-urticaria',
  name: '荨麻疹',
  prefix: 'hives',
  label: '荨麻疹',
  defaultEeriness: 2,
  gain: 0.3,
  flareChance: 0.3,
  flareGain: 22,
  triggerWeight: 1.05,
  flareWeight: 1,
  reliefs: [
    { id: 'antihistamine', label: '吃抗过敏药', relief: 26, minutes: 40, calm: 9 },
    { id: 'coldpack', label: '冷敷一下', relief: 16, minutes: 20, calm: 5 },
    { id: 'loose', label: '换件宽松衣服', relief: 10, minutes: 25, calm: 4 },
  ],
  body: {
    stiff: '脖子侧面有点刺痒，挠一下就好，过一会儿换个地方。',
    ache: '手臂内侧起了一片，越挠越热；一阵一阵地痒，位置还会跑。',
    flare: '整片起来了，痒得坐不住；刚挠过的地方肿成一条一条的。',
  },
  voice: {
    base: '允许话说一半停一下去挠，回来把刚才那句的开头再说一遍（因为被打断了）。别解释这是什么。',
    flare: '允许连着两三次「等一下」；不要描述疹子长什么样，也不要自嘲。',
  },
}
