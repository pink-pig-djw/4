# FAU Campus 3D · Südgelände

第一人称 3D 校园漫游：以 Friedrich-Alexander-Universität Erlangen-Nürnberg 的 **Südgelände（南校区，技术与自然科学）** 为蓝本，基于 OpenStreetMap 真实地理数据生成。
*First-person 3D walkthrough of FAU's Südgelände in Erlangen, built from real OpenStreetMap data.*

> 非官方爱好者作品，与 FAU 无关。建筑位置、朝向、大小、路网、楼名路名来自 OSM；外观为风格化还原；室内布局与所有人物均为虚构。
> Inoffizielles Fanprojekt. Kartendaten © OpenStreetMap-Mitwirkende (ODbL).

## 直接运行

| 文件 | 用法 |
|---|---|
| `dist/FAU-Campus.html` | **离线版**：双击用浏览器（Edge / Chrome）打开即可，不需要联网，也不需要安装 |
| `dist/FAU-Campus-3D.exe` | **Windows 版**：双击运行。游戏已打包在 exe 里，会用 Windows 自带的 Edge 以独立窗口打开（没有 Edge 时用默认浏览器）。未做数字签名，第一次运行 Windows 可能提示"未知发布者"，点"更多信息 → 仍要运行" |

## 操作

- 电脑：`WASD` 移动 · `Shift` 跑 · `空格` 跳 · `E` 对话 · `M` 地图 · `T` 切换天气 · `L` 中文/德语 · `Esc` 菜单
- 手机：左侧摇杆移动 · 右侧滑动看四周 · 右下按钮跳 / 跑 / 对话 · 右上地图、天气、菜单
- 地图里点地名或在列表里搜索，可以直接传送；标"可进入"的楼能走进去

## 内容

- **场景**：南校区约 1,100 栋建筑（高度按 OSM 楼层数），真实路网、草坪、树（约 8,400 棵）、长椅、自行车架（停满自行车）、路灯、公交站（真实站名）、德语路牌与楼名牌、玻璃回收箱、邮筒、停车场；校区与周边街区相连，没有围墙
- **天气与时间**：秋日午后（默认，灰天、落叶）、晴天、阴天、雨天（雨丝、水花、湿地面）、夜晚（窗户亮灯、路灯光圈）
- **可进入的楼**（室内虚构，外轮廓为真实）：
  - Mensa（用餐大厅、取餐台、收银、餐具回收、楼上咖啡角）及相连的报告厅楼（两个阶梯报告厅）
  - RRZE（机房 CIP-Pool、研讨室、服务器机房）
  - Felix-Klein-Gebäude · Mathematik（5 层楼梯间、环形走廊、中庭、研讨室、黑板）
- **人**：沿真实小路走动的学生和工作人员、骑车的人（会按铃）、坐长椅和草坪的人、Mensa 里吃饭和排队的人；可停下对话，33 段中德双语的留学生活对话（票价、时间、规章一律"以官网为准"）
- **声音**（Web Audio 实时合成，无音频文件）：风、远处车流、鸟叫、人声、车铃、雨声、按地面变化的脚步声、Mensa 餐具声；室内外音色不同（室内闷音 + 回声）

## 开发

```bash
npm install
npm run dev          # http://localhost:5173
npm run build        # dist/FAU-Campus.html（单文件离线版）
npm run build:exe    # dist/FAU-Campus-3D.exe（需要 Windows 自带的 .NET Framework 编译器）
npm test             # 自动巡逻测试
```

重新生成地图数据：

```bash
npm run fetch        # 通过 Overpass API 下载 OSM 数据 → data/raw/
npm run world        # 转换 → data/world/suedgelaende.json
```

### 自动巡逻测试（`npm test`）

用游戏本身的碰撞与移动代码在 Node 里跑，检查"掉进地面、卡住、撞到看不见的墙"：

1. 全部传送点能站稳（当前 92 个）
2. 沿地图上每一段小路和街道走一遍（当前 3,672 段，约 56 公里），不能被挡住
3. 300 个随机乱走乱跳的机器人（约 200 分钟模拟），不能掉出地面或进入建筑实体
4. 室内：每个楼梯间从底层走到顶层再下来、每扇入口门、报告厅过道、Mensa↔报告厅连通门（当前 19 条路线）

所有碰撞体都由看得见的物体生成（同一份布局数据同时用于渲染和碰撞），所以没有隐形墙。

## 目录

- `tools/` 数据下载、转换、测试、打包脚本
- `src/world/` 建筑、地面、植被、街道设施、天气、室内（`interiors/`）
- `src/physics/` 碰撞与角色控制（纯 JS，浏览器和测试共用）
- `src/npc/` 人物、行为、对话内容
- `src/audio/` 程序化声音
- `src/ui/` 界面、小地图、全屏地图、对话框、触屏操作
- `desktop/` Windows 启动器源码与图标

## 后续

第二阶段：老城区（Schloss、Schlossgarten、Kollegienhaus）· 第三阶段：纽伦堡校区。

## 版权与数据

- 地图数据 © OpenStreetMap 贡献者，采用 [ODbL](https://opendatacommons.org/licenses/odbl/) 许可；`data/` 下的衍生数据同样适用 ODbL
- 代码：MIT
