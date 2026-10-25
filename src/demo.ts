import { defaultSettings, type AppSnapshot } from "./model";
const svgUrl = (content: string) =>
  `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="680" viewBox="0 0 1000 680">${content}</svg>`)}`;
const examples = [
  [
    "把灵感，晾起来.png",
    "#d9e1d1",
    '<circle cx="730" cy="285" r="190" fill="#edf0e7"/><path d="M0 525Q210 300 450 510T1000 420V680H0" fill="#84967d"/><path d="M0 610Q340 450 590 620T1000 570V680H0" fill="#49624f"/><text x="72" y="135" fill="#324b39" font-family="Arial" font-size="68">A little room</text><text x="72" y="215" fill="#324b39" font-family="Arial" font-size="68">for inspiration.</text>',
  ],
  [
    "周末的色彩.png",
    "#e9c7a9",
    '<rect x="145" y="120" width="245" height="400" rx="120" fill="#c16e4d"/><circle cx="650" cy="330" r="175" fill="#f7ebd4"/><path d="M520 510V300Q650 200 780 300V510" fill="#81927a"/><text x="70" y="625" font-family="Arial" font-size="26" letter-spacing="8" fill="#694c3e">SLOW DAYS, GOOD IDEAS</text>',
  ],
  [
    "项目笔记.png",
    "#e8e6e1",
    '<rect x="100" y="65" width="800" height="550" rx="15" fill="#fcfbf8"/><rect x="100" y="65" width="800" height="55" rx="15" fill="#deddd8"/><circle cx="130" cy="92" r="7" fill="#c37c66"/><circle cx="155" cy="92" r="7" fill="#c3ac74"/><circle cx="180" cy="92" r="7" fill="#879b7b"/><text x="155" y="205" font-family="Arial" font-size="38" fill="#353b36">Small things. Well made.</text><rect x="155" y="245" width="420" height="12" rx="6" fill="#cecec5"/><rect x="155" y="273" width="560" height="12" rx="6" fill="#e0dfd7"/><rect x="155" y="330" width="270" height="200" rx="12" fill="#d8dfcf"/><rect x="455" y="330" width="380" height="85" rx="12" fill="#eee6da"/><rect x="455" y="445" width="380" height="85" rx="12" fill="#e3e6eb"/>',
  ],
  [
    "留一点空白.png",
    "#f1eadc",
    '<circle cx="680" cy="275" r="150" fill="#d7ac65"/><path d="M0 540L280 260 600 680H0" fill="#768675"/><path d="M220 680L660 340 1000 680" fill="#aab3a0"/><text x="75" y="120" font-family="Georgia" font-style="italic" font-size="55" fill="#5b604f">Less, but better.</text>',
  ],
  [
    "界面配色参考.png",
    "#e9e2d9",
    '<rect x="80" y="90" width="250" height="400" rx="125" fill="#b56349"/><rect x="375" y="90" width="250" height="400" rx="125" fill="#74846c"/><rect x="670" y="90" width="250" height="400" rx="125" fill="#d1b98f"/><text x="90" y="570" font-family="Arial" font-size="24" fill="#5f5d56">TERRACOTTA</text><text x="390" y="570" font-family="Arial" font-size="24" fill="#5f5d56">SAGE</text><text x="705" y="570" font-family="Arial" font-size="24" fill="#5f5d56">SAND</text>',
  ],
  [
    "一段好风景.png",
    "#cbd8da",
    '<circle cx="750" cy="170" r="85" fill="#f6e7bd"/><path d="M0 410L220 185 490 485 710 285 1000 460V680H0" fill="#8ca19d"/><path d="M0 500L270 350 620 550 860 390 1000 470V680H0" fill="#5d7c74"/><path d="M0 565Q350 510 1000 590V680H0" fill="#dce3d8"/>',
  ],
];
export function createDemo(): AppSnapshot {
  return {
    storagePath: "浏览器演示 · 数据仅保存在当前页面",
    settings: { ...defaultSettings, theme: "light" },
    items: examples.map(([name, color, art], index) => ({
      id: `demo-${index}`,
      name,
      path: "",
      thumbnail: svgUrl(
        `<rect width="1000" height="680" fill="${color}"/>${art}`,
      ),
      kind: "image",
      width: 1000,
      height: 680,
      createdAt:
        Date.now() - index * 1000 * 60 * 31 - (index > 2 ? 86400000 : 0),
      source: index % 2 ? "导入图片" : "剪贴板",
      pinned: index === 1 || index === 4,
      shelfHidden: false,
    })),
  };
}
