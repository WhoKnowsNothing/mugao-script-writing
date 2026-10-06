export const PLATFORM_IDS = [
  'douyin',
  'xiaohongshu',
  'channels',
  'bilibili',
] as const;
export type PlatformId = (typeof PLATFORM_IDS)[number];

export interface PlatformRule {
  id: PlatformId;
  name: string;
  source: string;
  sourceTitle: string;
  checkedAt: string;
  coverage: string;
  verified: boolean;
  guidance: string[];
}

// Human-curated, partial summaries, not a claim to fetch current platform policy.
export const PLATFORM_RULES: PlatformRule[] = [
  {
    id: 'douyin',
    name: '抖音',
    source:
      'https://lf3-cdn-tos.draftstatic.com/obj/ies-hotsoon-draft/douyin_creator/40db1b96-0eb0-4754-a052-16e8325af350.html',
    sourceTitle: '抖音社区自律公约',
    checkedAt: '2026-10-05',
    verified: true,
    coverage: '公开公约摘要；不含全部专项规则，原页未标明修订日期。',
    guidance: [
      '核对虚假或误导性信息、冒用身份，以及侵犯名誉、肖像、隐私和知识产权的风险。',
      '关注未成年人安全、危险行为、色情暴力及违法营销；医疗类内容需另核资质与医疗专项规则。',
    ],
  },
  {
    id: 'xiaohongshu',
    name: '小红书',
    source:
      'https://pgy.xiaohongshu.com/help/detail?id=1eda0a065dd894063c2e029a49e8f6a1&userType=4',
    sourceTitle: '小红书社区公约 2.0',
    checkedAt: '2026-10-05',
    verified: true,
    coverage: '2026-07-31 官方公开页面摘要；不含全部交易、广告和行业规则。',
    guidance: [
      '分享应基于真实经历或原创，核实存疑信息，使用他人素材需获得授权。',
      '不要伪造财富、学历、收入或情感经历；避免把摆拍包装成真实生活。',
      '公约建议主动说明 AI 辅助参与，包括生成、润色或灵感辅助；不要将建议写成一律处罚的硬性条款。',
    ],
  },
  {
    id: 'channels',
    name: '视频号',
    source:
      'https://weixin.qq.com/cgi-bin/readtemplate?lang=zh_CN&t=weixin_agreement&s=video',
    sourceTitle: '微信视频号运营规范',
    checkedAt: '2026-10-05',
    verified: false,
    coverage: '官方正文未能读取核验；当前仅作通用风险提示，请补充最新规则。',
    guidance: [],
  },
  {
    id: 'bilibili',
    name: 'B站',
    source: 'https://member.bilibili.com/studio/convention/',
    sourceTitle: 'bilibili 社区公约',
    checkedAt: '2026-10-05',
    verified: true,
    coverage: '公开总则摘要；不含完整违规分类、投稿和商业推广细则。',
    guidance: [
      '基于真实信息创作，不抄袭、捏造、造谣传谣或有意误导。',
      '尊重不同观点，避免引战、人身攻击、诋毁、辱骂及制造对立。',
    ],
  },
];

export function selectedRules(ids: PlatformId[]) {
  return PLATFORM_RULES.filter((rule) => ids.includes(rule.id));
}

export function rulesAreOld(now = Date.now()): boolean {
  return now - Date.parse('2026-10-05T00:00:00+08:00') > 30 * 86400000;
}
