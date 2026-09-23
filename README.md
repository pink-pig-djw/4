# FAU Campus 3D · Erlangen & Nürnberg

第一人称 3D 校园漫游：以 Friedrich-Alexander-Universität Erlangen-Nürnberg 的 **Südgelände（南校区，工学院 Technische Fakultät）**、往南约 4 公里的 **Tennenlohe**（EEI 教研室、Fraunhofer IIS）和北边的 **老城区 Altstadt**（宫殿 Schloss、宫廷花园 Schlossgarten、学院楼 Kollegienhaus）为蓝本，基于 OpenStreetMap 真实地理数据和巴伐利亚官方 1 米数字高程模型生成。三处连成一张大地图，沿真实道路可以一路走过去（南校区 → 宫殿约 3.7 公里）。
第二张地图是 **纽伦堡老城**：FAU 经济与社会科学学院（Findelgasse、Lange Gasse）、皇帝堡、圣洛伦茨教堂、中央集市广场、城墙与城门塔、佩格尼茨河上的桥。开始界面里选择地图。
*First-person 3D walkthrough of FAU in Erlangen (Südgelände, Tennenlohe and the old town as one continuous map) and in Nürnberg's walled old town, built from real OpenStreetMap data and the Bavarian 1 m terrain model.*

> 非官方爱好者作品，与 FAU 无关。建筑位置、朝向、大小、路网、楼名路名来自 OSM，地形起伏来自官方高程数据；外观为程序化还原；室内布局与所有人物均为虚构。
> Inoffizielles Fanprojekt. Kartendaten © OpenStreetMap-Mitwirkende (ODbL). Geländemodell: Bayerische Vermessungsverwaltung – www.geodaten.bayern.de (DGM1, CC BY 4.0).

## 直接运行

| 文件 | 用法 |
|---|---|
| `dist/FAU-Campus.html` | **离线版**：双击用浏览器（Edge / Chrome）打开即可，不需要联网，也不需要安装；两张地图都在里面，开始界面选择 |
| `dist/FAU-Campus-3D.exe` | **Windows 版**：双击运行。游戏已打包在 exe 里，会用 Windows 自带的 Edge 以独立窗口打开（没有 Edge 时用默认浏览器）。未做数字签名，第一次运行 Windows 可能提示"未知发布者"，点"更多信息 → 仍要运行" |

## 操作

- 电脑：`WASD` 移动 · `Shift` 跑 · `空格` 跳 · `E` 对话 · `M` 地图 · `T` 切换天气 · `L` 中文/德语 · `Esc` 菜单
- 手机：左侧摇杆移动 · 右侧滑动看四周 · 右下按钮跳 / 跑 / 对话 · 右上地图、天气、菜单
- 地图里点地名或在列表里搜索，可以直接传送；标"可进入"的楼能走进去

## 内容

- **场景**：Tennenlohe — 南校区 — Röthelheimpark — 老城区，约 3.3 × 7.2 公里，11,042 栋建筑（高度按 OSM 楼层数），真实路网（含 A3、A73 高速和 95 段桥）、草坪、约 10 万棵树（9 个树种，林区以欧洲赤松为主）、长椅、自行车架、路灯、公交站（真实站名）、德语路牌与楼名牌、围栏与墙、停车场、喷泉与雕塑（131 处，只放 OSM 里有的）
- **老城区**：宫殿（砂岩方石立面、老虎窗）、巴洛克宫邸和老城房屋（壁柱、檐口、窗框、老虎窗，按文物登记自动识别）、宫廷花园与胡格诺喷泉（岩山）、花坛、橘园、学院楼
- **中间连接地带**：南校区、Tennenlohe、老城区之外的普通民宅/厂房做了简化（不加屋顶设备、雨水管、老虎窗），地标建筑（有名字、公共建筑、文物、高楼）保持完整细节
- **桥**：桥面高度按整座桥连通计算，桥下通行的路、铁路、河道按真实净空抬高桥面或降低路面；人行道在桥面上，路口处栏杆留开口
- **地形**：巴伐利亚测绘局 DGM1（1 米）重采样为 3 米网格；路堤、路堑、桥、池塘都按真实高度，楼门前的地面按室内地面平整
- **位置显示**：左上角显示所在楼、公园（如 Schlossgarten Erlangen）、街道和城区（OSM 地名）
- **纽伦堡老城**（第二张地图，约 2.4 × 2 公里，6,434 栋建筑）：红褐色城堡砂岩——哥特式教堂（圣洛伦茨、圣塞巴尔德、圣母教堂：方石墙、扶壁、尖拱长窗和窗花格）、城门塔（Spittlertor、Frauentor、Laufer Tor、Neutor）、皇帝堡所在岩山上的建筑；约 7 米高、带木顶走道的城墙；老城陡屋顶上成排的老虎窗；佩格尼茨河（河面随河道逐段下降）与肉桥（Fleischbrücke）、博物馆桥等；丢勒像、Hesperidengärten 巴洛克花园里的雕像和小喷泉（174 处，只放 OSM 里有的）
- **写实细节**：窗洞有深度、玻璃后能看到房间（办公室、住宅纱帘、停车楼）、屋顶女儿墙与设备、入口雨棚、雨水管；树木按树种生成，秋色与落叶程度各不相同
- **天气与时间**：秋日午后（默认，灰天、落叶）、晴天、阴天、雨天（雨丝、水花、湿地面）、夜晚（窗户亮灯、路灯光圈）
- **可进入的楼**（室内虚构，外轮廓为真实）：
  - Mensa（用餐大厅、取餐台、收银、餐具回收、楼上咖啡角）及相连的报告厅楼（两个阶梯报告厅）
  - RRZE（机房 CIP-Pool、研讨室、服务器机房）
  - Felix-Klein-Gebäude · Mathematik（5 层楼梯间、环形走廊、中庭、研讨室、黑板）
  - Elektrotechnik（EEI，Cauerstraße）：电子实验室（示波器、电源、面包板）、计算机房、研讨室，可上到 5 楼
  - 学院楼 Kollegienhaus（老城区，中间一栋）：一楼门厅，二楼大礼堂 Aula（讲台、成排座椅、吊灯）
  - 纽伦堡：FAU 经济与社会科学 Findelgasse 7/9（研讨室、计算机房、办公室、楼梯间；开始位置就在它门口）
- **人**：沿真实小路走动的学生和工作人员、骑车的人（会按铃）、坐长椅和草坪的人、Mensa 里吃饭和排队的人；可停下对话，43 段中德双语的留学生活对话，按所在地点挑选（宫殿、宫廷花园、学院楼、Tennenlohe、纽伦堡各有专门话题；票价、时间、规章一律"以官网为准"）
- **声音**（Web Audio 实时合成，无音频文件）：风、远处车流、鸟叫、人声、车铃、雨声、按地面变化的脚步声、Mensa 餐具声；室内外音色不同（室内闷音 + 回声）

## 开发

```bash
npm install
npm run dev          # http://localhost:5173
npm run build        # dist/FAU-Campus.html（单文件离线版）
npm run build:exe    # dist/FAU-Campus-3D.exe（需要 Windows 自带的 .NET Framework 编译器）
npm test             # 自动巡逻测试
```

重新生成地图数据（地区：`suedgelaende` = 埃尔朗根，`nuernberg` = 纽伦堡）：

```bash
npm run fetch -- nuernberg   # 通过 Overpass API 下载 OSM 数据 → data/raw/（不入库）
npm run dem -- nuernberg     # 下载巴伐利亚 DGM1 高程瓦片 → data/raw/dgm1/（不入库）
npm run world -- nuernberg   # 转换 → data/world/nuernberg.json（含压缩后的 3 米地形）
```

### 自动巡逻测试（`npm test`，两张地图都测）

用游戏本身的碰撞与移动代码在 Node 里跑，检查"掉进地面、卡住、撞到看不见的墙"：

1. 全部传送点能站稳（埃尔朗根 596 个，纽伦堡 311 个）
2. 沿地图上每一段小路和街道走一遍（埃尔朗根 29,447 段约 465 公里，纽伦堡 11,110 段约 159 公里，包括桥面和桥下），不能被挡住
3. 每张地图 300 个随机乱走乱跳的机器人（约 200 分钟模拟），不能掉出地面或进入建筑实体
4. 室内：每个楼梯间从底层走到顶层再下来、每扇入口门、报告厅过道、Aula 过道、Mensa↔报告厅连通门（26 + 4 条路线）

所有碰撞体都由看得见的物体生成（同一份布局数据同时用于渲染和碰撞），所以没有隐形墙。

已知限制（测试里单独列出，不算失败）：埃尔朗根 A73 下两处很短的地下通道和老城北边一座很短的人行桥下，纽伦堡 Franz-Josef-Strauß-Brücke 桥边的河岸小路和东边护城河旁一座小桥边的小路——桥两端离得太近或小路贴着桥边下到河岸，3 米地形网格做不出垂直的桥台墙，桥面在头顶偏低（看得见的阻挡，不是隐形墙）。

## 目录

- `tools/` 数据下载、转换、测试、打包脚本
- `src/world/` 建筑、地面、植被、街道设施、天气、室内（`interiors/`）
- `src/physics/` 碰撞与角色控制（纯 JS，浏览器和测试共用）
- `src/npc/` 人物、行为、对话内容
- `src/audio/` 程序化声音
- `src/ui/` 界面、小地图、全屏地图、对话框、触屏操作
- `desktop/` Windows 启动器源码与图标

## 后续

可以继续扩展：纽伦堡 FAU 其他地点（Auf AEG 能源园区、Regensburger Straße 校区）等。

## 版权与数据

- 地图数据 © OpenStreetMap 贡献者，采用 [ODbL](https://opendatacommons.org/licenses/odbl/) 许可；`data/` 下的衍生数据同样适用 ODbL
- 地形：Bayerische Vermessungsverwaltung – [www.geodaten.bayern.de](https://www.geodaten.bayern.de)，DGM1，[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)（经重采样、平滑与场地平整处理）
- 代码：MIT
