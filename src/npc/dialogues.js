// Short conversations about everyday student life in Erlangen. All characters are fictional.
// Rule: no concrete prices, times or regulations — always point to the official source ("以官网为准").
// Format: nodes { key: { npc: {de, zh}, opts: [{ de, zh, go? }] } }, starting at "start". go = null ends.

export const FIRST_NAMES = {
  f: ['Lena', 'Mia', 'Sophie', 'Hannah', 'Emma', 'Marie', 'Anna', 'Laura', 'Clara', 'Lea', 'Aylin', 'Chiara', 'Priya', 'Yuki', 'Nora', 'Jana', 'Svenja', 'Elif', 'Marta', 'Ines'],
  m: ['Jonas', 'Paul', 'Lukas', 'Leon', 'Ben', 'Tim', 'Julian', 'Moritz', 'Niklas', 'Finn', 'Mehmet', 'Mateo', 'Arjun', 'Tobias', 'Jakob', 'Samuel', 'Emil', 'David', 'Karim', 'Luca'],
};
export const ROLES = {
  student: [{ de: 'studiert Informatik', zh: '计算机专业学生' }, { de: 'studiert Maschinenbau', zh: '机械工程专业学生' }, { de: 'studiert Physik', zh: '物理专业学生' },
    { de: 'studiert Chemie', zh: '化学专业学生' }, { de: 'studiert Mathematik', zh: '数学专业学生' }, { de: 'studiert Elektrotechnik', zh: '电气工程专业学生' },
    { de: 'studiert Materialwissenschaft', zh: '材料科学专业学生' }, { de: 'Austauschstudentin', zh: '交换生' }, { de: 'studiert Medizintechnik', zh: '医学工程专业学生' }],
  staff: [{ de: 'Doktorand am Lehrstuhl', zh: '教研室博士生' }, { de: 'Tutorin', zh: '助教' }, { de: 'arbeitet in der Verwaltung', zh: '行政工作人员' }, { de: 'Hausmeister', zh: '楼管' }],
  mensa: [{ de: 'arbeitet in der Mensa', zh: 'Mensa 工作人员' }],
};

const D = (id, ctx, nodes) => ({ id, ctx, nodes });
const n = (de, zh, opts) => ({ npc: { de, zh }, opts });
const o = (de, zh, go = null) => ({ de, zh, go });
const BYE = o('Danke, tschüss!', '谢谢，再见！');

export const DIALOGUES = [
  // ---------------- Mensa ----------------
  D('mensa-pay', ['mensa', 'any'], {
    start: n('Servus! Auch auf dem Weg zur Mensa?', '你好（Servus 是法兰肯地区常用的问候）！你也去 Mensa 吃饭吗？',
      [o('Ja! Wie bezahlt man da eigentlich?', '是啊！在那儿怎么付钱？', 'pay'), o('Nein, ich schaue mich nur um.', '没有，我只是随便看看。', 'look')]),
    pay: n('Meistens mit der Karte vom Studierendenwerk bzw. dem Studierendenausweis. Aufladen kannst du sie an den Automaten am Eingang. Was genau gilt, steht auf der Website vom Studierendenwerk.',
      '一般用学生卡（学生服务中心 Studierendenwerk 的卡）付款，入口处的充值机可以充钱。具体规定以 Studierendenwerk 官网为准。',
      [o('Und was kostet ein Essen?', '一顿饭大概多少钱？', 'price'), BYE]),
    price: n('Das ändert sich immer wieder – der aktuelle Speiseplan mit Preisen steht online. Für Studis ist es aber meistens günstiger als im Restaurant.',
      '价格会调整，最新菜单和价格以官网为准。不过对学生来说一般比餐馆便宜。',
      [o('Gut zu wissen, danke!', '好的，谢谢！')]),
    look: n('Dann: Viel Spaß! Die Mensa ist das große Gebäude am Platz, kaum zu übersehen.', '那祝你逛得开心！Mensa 就是广场边那栋大楼，很好找。', [BYE]),
  }),
  D('mensa-words', ['mensa'], {
    start: n('Hallo! Du schaust so ratlos auf den Speiseplan – kann ich helfen?', '你好！你看菜单的样子有点迷茫——需要帮忙吗？',
      [o('Was bedeutet „Beilage"?', '"Beilage" 是什么意思？', 'beilage'), o('Welches Essen ist vegetarisch?', '哪个是素食？', 'veg')]),
    beilage: n('„Beilage" ist das Extra zum Hauptgericht – zum Beispiel Kartoffeln, Reis oder Salat. Oft kannst du sie auch einzeln nehmen.',
      '"Beilage" 是主菜的配菜，比如土豆、米饭或沙拉，经常也可以单点。',
      [o('Und „Tagesgericht"?', '那 "Tagesgericht" 呢？', 'tages'), BYE]),
    tages: n('Das ist das Gericht des Tages. Schau einfach auf die Symbole: Da steht meistens, ob etwas vegetarisch oder vegan ist.',
      '就是今日菜。看菜名旁边的小图标，一般会标出素食（vegetarisch）或纯素（vegan）。', [o('Danke, guten Appetit!', '谢谢，祝你用餐愉快！')]),
    veg: n('Such nach „vegetarisch" oder „vegan" – das ist im Plan gekennzeichnet. Bei Allergien frag lieber an der Ausgabe nach.',
      '找标着 "vegetarisch"（素食）或 "vegan"（纯素）的菜。如果有过敏，最好在取餐台问一下。', [BYE]),
  }),
  D('mensa-staff', ['mensastaff'], {
    start: n('Hallo! Was darf\'s sein?', '你好！想要点什么？',
      [o('Das Tagesgericht, bitte.', '请给我今日菜。', 'dish'), o('Was können Sie empfehlen?', '有什么推荐吗？', 'rec')]),
    dish: n('Gerne! Soße dazu?', '好的！要浇汁吗？', [o('Ja, gerne.', '好的，要。', 'end'), o('Nein, danke.', '不用，谢谢。', 'end')]),
    rec: n('Heute ist das vegetarische Gericht sehr beliebt. Aber schau ruhig selbst – alles steht vorne angeschrieben.', '今天的素食很受欢迎。你也可以自己看看，前面都写着呢。', [o('Dann nehme ich das.', '那我就要这个。', 'end')]),
    end: n('Bitte schön. Bezahlen kannst du vorne an der Kasse. Guten Appetit!', '给你。在前面收银台付款。祝你用餐愉快！', [o('Danke!', '谢谢！')]),
  }),
  D('mensa-tray', ['mensa'], {
    start: n('Kleiner Tipp: Das Tablett bringst du nach dem Essen zur Geschirrrückgabe.', '小提示：吃完饭后把托盘送到餐具回收处（Geschirrrückgabe）。',
      [o('Wo ist die?', '在哪儿？', 'where'), o('Ah, das wusste ich nicht. Danke!', '啊，我不知道，谢谢！')]),
    where: n('Da hinten, das Band an der Seite. Einfach draufstellen – fertig.', '在后面侧边那条传送带，放上去就行。', [BYE]),
  }),
  D('mensa-seat', ['mensa'], {
    start: n('Hi! Ist hier noch frei?', '嗨！这里有人坐吗？',
      [o('Ja, setz dich ruhig!', '没人，坐吧！', 'sit'), o('Nein, tut mir leid, hier sitzt schon jemand.', '不好意思，有人了。', 'no')]),
    sit: n('Danke! Wie lange bist du schon in Erlangen?', '谢谢！你来埃尔朗根多久了？',
      [o('Erst seit ein paar Wochen.', '才几个星期。', 'new'), o('Schon ein Jahr.', '已经一年了。', 'old')]),
    new: n('Willkommen! Am Anfang ist alles etwas viel – aber das wird schnell. Die Fachschaft macht oft Treffen für Neue.', '欢迎！刚开始会有点应接不暇，但很快就习惯了。系里的学生会（Fachschaft）经常组织新生活动。', [o('Das klingt gut, danke!', '听起来不错，谢谢！')]),
    old: n('Dann kennst du dich ja schon aus. Hast du einen Lieblingsplatz zum Lernen?', '那你已经很熟悉了。你有最喜欢的学习地方吗？', [o('Die Bibliothek hier nebenan.', '旁边的图书馆。', 'lib'), BYE]),
    lib: n('Gute Wahl. Da ist es in der Prüfungszeit aber richtig voll!', '好选择。不过考试期间那里人超多！', [o('Stimmt! Bis dann.', '没错！回头见。')]),
    no: n('Kein Problem, ich finde was anderes.', '没关系，我再找找。', [o('Tschüss!', '再见！')]),
  }),
  // ---------------- Bike ----------------
  D('bike-lights', ['bike', 'night', 'any'], {
    start: n('Hey, fährst du auch mit dem Rad zur Uni?', '嘿，你也骑车来学校吗？',
      [o('Ja. Worauf muss ich in Deutschland achten?', '是的。在德国骑车要注意什么？', 'rules'), o('Nein, mit dem Bus.', '不，坐公交。', 'bus')]),
    rules: n('Rechts fahren, Handzeichen beim Abbiegen, und wenn es dunkel ist: Licht an! Ohne Licht wird es teuer – und gefährlich.',
      '靠右骑，转弯打手势，天黑一定要开灯！不开灯会被罚款，而且很危险。具体规定和罚款以官方交通规则为准。',
      [o('Darf ich auf dem Gehweg fahren?', '可以在人行道上骑吗？', 'side'), o('Und das Schloss?', '锁车呢？', 'lock')]),
    side: n('Normalerweise nicht – nimm den Radweg oder die Straße. Achte auf die Schilder, manche Wege sind für Räder freigegeben.',
      '一般不行，要走自行车道或者马路。注意路牌，有些路标明允许自行车通行。', [o('Okay, danke!', '好的，谢谢！')]),
    lock: n('Immer am Bügel anschließen, nicht nur das Rad selbst. Leider werden in Uni-Städten öfter Räder geklaut.',
      '一定要锁在车架上，不能只锁轮子。很遗憾，大学城偷车挺常见的。', [o('Gut, mache ich.', '好，我会的。')]),
    bus: n('Auch gut. Bei Regen ist der Bus sowieso gemütlicher.', '也不错，下雨天坐公交更舒服。', [BYE]),
  }),
  D('bike-repair', ['bike'], {
    start: n('Mist, mein Reifen ist schon wieder platt.', '糟糕，我的车胎又瘪了。',
      [o('Gibt es hier eine Luftpumpe?', '这附近有打气筒吗？', 'pump'), o('Oh nein. Viel Glück!', '哎呀，祝你好运！')]),
    pump: n('Ja, hier auf dem Gelände gibt es ein paar Fahrrad-Reparaturstationen mit Pumpe und Werkzeug. Frag einfach herum oder halt die Augen offen.',
      '有的，校区里有几个自行车维修站，带打气筒和工具。可以问问别人，或者留意一下路边。', [o('Praktisch! Danke.', '真方便，谢谢！')]),
  }),
  D('bike-city', ['bike', 'any'], {
    start: n('Wusstest du, dass Erlangen als Fahrradstadt gilt?', '你知道吗，埃尔朗根被称为"自行车城市"？',
      [o('Wirklich? Warum?', '真的？为什么？', 'why'), o('Ja, man sieht überall Fahrräder!', '是的，到处都是自行车！', 'yes')]),
    why: n('Die Stadt ist flach, die Wege sind kurz und es gibt viele Radwege. Viele Studis fahren fast überall hin mit dem Rad.',
      '城市地势平坦、距离近、自行车道多。很多学生几乎去哪儿都骑车。', [o('Dann brauche ich wohl auch eins.', '看来我也得买一辆了。', 'buy')]),
    yes: n('Genau, schau dir nur die Fahrradständer vor der Mensa an!', '没错，看看 Mensa 前面的车架就知道了！', [BYE]),
    buy: n('Gebrauchte Räder findest du oft auf Flohmärkten oder in Online-Kleinanzeigen. Lass es aber vorher checken!', '二手车常能在跳蚤市场或网上分类广告找到。买之前最好检查一下！', [o('Guter Tipp, danke!', '好建议，谢谢！')]),
  }),
  // ---------------- German phrases ----------------
  D('phrases-greet', ['any'], {
    start: n('Grüß Gott! Du bist neu hier, oder?', 'Grüß Gott（南德常用问候）！你是新来的吧？',
      [o('Ja. „Grüß Gott"? Ich dachte, man sagt „Hallo".', '是的。"Grüß Gott"？我以为大家说 "Hallo"。', 'greet'), o('Ja, ich lerne noch Deutsch.', '对，我还在学德语。', 'learn')]),
    greet: n('Beides geht! In Franken hörst du auch oft „Servus". Und zum Abschied „Tschüss" oder „Ade".',
      '两个都行！在法兰肯地区你还会经常听到 "Servus"。告别时说 "Tschüss" 或者 "Ade"。', [o('Servus dann!', '那就 Servus！', 'servus')]),
    servus: n('Perfekt, du klingst schon wie ein Franke!', '完美，你听起来已经像个法兰肯人了！', [o('Ade!', '再见（Ade）！')]),
    learn: n('Keine Sorge. Wenn du etwas nicht verstehst, sag einfach: „Können Sie das bitte wiederholen?"',
      '别担心。听不懂的时候就说："Können Sie das bitte wiederholen?"（您能再说一遍吗？）', [o('Können Sie das bitte wiederholen?', '您能再说一遍吗？', 'rep'), BYE]),
    rep: n('Haha, genau so! Und langsamer geht auch: „Etwas langsamer, bitte."', '哈哈，就是这样！还可以说："Etwas langsamer, bitte."（请说慢一点。）', [o('Danke schön!', '非常感谢！')]),
  }),
  D('phrases-du-sie', ['any', 'study'], {
    start: n('Sag mal, duzt du hier eigentlich alle?', '问一下，你在这里对所有人都用 "du" 吗？',
      [o('Wann sagt man „du", wann „Sie"?', '什么时候用 "du"，什么时候用 "Sie"？', 'rule')]),
    rule: n('Unter Studis fast immer „du". Bei Profs, in der Verwaltung oder bei Fremden erst mal „Sie" – bis dir jemand das Du anbietet.',
      '学生之间几乎都用 "du"。对教授、行政人员或陌生人先用 "Sie"，直到对方提出可以用 "du"。',
      [o('Und in E-Mails?', '那写邮件呢？', 'mail')]),
    mail: n('An Profs: „Sehr geehrte Frau Professorin …" bzw. „Sehr geehrter Herr Professor …" – und am Ende „Mit freundlichen Grüßen".',
      '给教授写信开头用 "Sehr geehrte Frau Professorin …" / "Sehr geehrter Herr Professor …"，结尾写 "Mit freundlichen Grüßen"。', [o('Das schreibe ich mir auf!', '我记下来了！')]),
  }),
  D('phrases-passt', ['any'], {
    start: n('Ups, sorry, hab dich angerempelt!', '哎呀，不好意思，撞到你了！',
      [o('Kein Problem!', '没关系！', 'passt'), o('Alles gut.', '没事。', 'passt')]),
    passt: n('Passt scho! … Das sagt man hier in Franken, heißt so viel wie „passt schon, alles okay".', '"Passt scho"！……这是法兰肯方言，意思是"没事、挺好"。', [o('Passt scho!', 'Passt scho！')]),
  }),
  // ---------------- Finding rooms ----------------
  D('rooms', ['study', 'any'], {
    start: n('Hallo! Suchst du einen Raum?', '你好！你在找教室吗？',
      [o('Ja. Wie lese ich die Raumnummern?', '是的，房间号怎么看？', 'num'), o('Wo finde ich meinen Stundenplan?', '课表在哪里查？', 'plan')]),
    num: n('Meistens steht vorne das Stockwerk, dann die Raumnummer – aber das ist nicht in jedem Gebäude gleich. Folg einfach den Wegweisern im Flur.',
      '一般前面是楼层，后面是房间号——但不是每栋楼都一样。跟着走廊里的指示牌走就好。',
      [o('Was heißt EG und OG?', 'EG 和 OG 是什么意思？', 'eg'), BYE]),
    eg: n('EG ist das Erdgeschoss, also ganz unten. 1. OG ist der erste Stock darüber.', 'EG 是地面层（Erdgeschoss），也就是中国说的一楼；1. OG 是它上面一层（中国的二楼）。', [o('Ah, deshalb! Danke.', '原来如此！谢谢。')]),
    plan: n('Lehrveranstaltungen und Räume findest du im Uni-Portal online. Was genau wo steht, schau am besten auf den offiziellen FAU-Seiten nach.',
      '课程和教室可以在学校的在线门户上查。具体信息以 FAU 官网为准。', [BYE]),
  }),
  D('rooms-hall', ['lecture'], {
    start: n('Ist das hier der richtige Hörsaal für Mathe für Ingenieure?', '这是"工程数学"的报告厅吗？',
      [o('Keine Ahnung, ich bin auch neu.', '不知道，我也是新来的。', 'new'), o('Schau mal auf den Plan am Eingang.', '看看门口的课表。', 'plan')]),
    new: n('Dann suchen wir zusammen! Übrigens: Am Ende der Vorlesung klopft man hier auf den Tisch statt zu klatschen.',
      '那我们一起找吧！对了：在这里下课时大家是敲桌子，而不是鼓掌。', [o('Echt? Das ist lustig!', '真的吗？好有意思！', 'knock')]),
    knock: n('Ja, deutsche Uni-Tradition. Probier\'s nachher aus!', '是啊，德国大学的传统。等会儿试试！', [o('Mache ich!', '我会的！')]),
    plan: n('Gute Idee. Und ist hier noch frei?', '好主意。这里有人坐吗？', [o('Ja, setz dich.', '没人，坐吧。')]),
  }),
  // ---------------- Library / study ----------------
  D('library', ['study', 'any'], {
    start: n('Gehst du auch in die Bibliothek?', '你也去图书馆吗？',
      [o('Wie sind die Öffnungszeiten?', '开放时间是几点？', 'time'), o('Kann ich meine Tasche mitnehmen?', '可以带包进去吗？', 'bag')]),
    time: n('Die ändern sich in den Ferien und in der Prüfungszeit – schau am besten auf die Website der Unibibliothek.',
      '假期和考试期间会有变化——以大学图书馆官网为准。', [BYE]),
    bag: n('Große Taschen und Jacken kommen oft in die Schließfächer. Frag am besten am Eingang, wie es dort geregelt ist.',
      '大包和外套一般要放储物柜。具体规定在入口处问一下比较好。', [o('Gut, danke!', '好的，谢谢！')]),
  }),
  D('study-sprechstunde', ['study'], {
    start: n('Ich muss gleich zur Sprechstunde von meinem Prof.', '我一会儿要去教授的答疑时间（Sprechstunde）。',
      [o('Was ist eine Sprechstunde?', 'Sprechstunde 是什么？', 'what'), o('Viel Erfolg!', '祝你顺利！')]),
    what: n('Eine feste Zeit, in der du mit Fragen vorbeikommen kannst. Manchmal braucht man vorher einen Termin per E-Mail – steht meist auf der Lehrstuhl-Website.',
      '就是固定的时间段，可以带着问题去找老师。有时需要提前发邮件预约——一般写在教研室网站上。', [o('Das ist praktisch.', '这很方便。')]),
  }),
  D('study-uebung', ['study', 'math'], {
    start: n('Hast du das Übungsblatt schon fertig?', '你的练习题（Übungsblatt）做完了吗？',
      [o('Was ist ein Übungsblatt?', 'Übungsblatt 是什么？', 'what'), o('Noch nicht, Aufgabe 3 ist schwer.', '还没，第三题好难。', 'hard')]),
    what: n('Die wöchentlichen Aufgaben zur Vorlesung. Besprochen werden sie im Tutorium – da kannst du auch gut Fragen stellen.',
      '就是每周配合课程的作业题，会在习题课（Tutorium）上讲解，那里也可以提问。', [BYE]),
    hard: n('Lass uns nachher im Lernraum zusammen draufschauen. Gemeinsam geht\'s leichter!', '等会儿我们去自习室一起看看吧，一起做更容易！', [o('Gerne!', '好啊！')]),
  }),
  D('math-boards', ['math'], {
    start: n('Hier im Mathegebäude wird noch viel mit Kreide an der Tafel gearbeitet.', '在数学楼里，大家还经常用粉笔在黑板上写。',
      [o('Wirklich? Keine Folien?', '真的吗？不用幻灯片？', 'why')]),
    why: n('Viele finden, dass man Beweise besser versteht, wenn sie Schritt für Schritt an der Tafel entstehen.', '很多人觉得，看着证明在黑板上一步步写出来更容易理解。', [o('Das klingt einleuchtend.', '听起来有道理。')]),
  }),
  // ---------------- IT / RRZE ----------------
  D('it-wlan', ['rrze', 'study'], {
    start: n('Hast du schon WLAN auf dem Campus?', '你在校园里连上 WLAN 了吗？',
      [o('Nein, wie geht das?', '还没有，怎么连？', 'how'), o('Ja, alles gut.', '连上了，没问题。')]),
    how: n('An vielen Unis gibt es „eduroam". Die Anleitung und deine Zugangsdaten bekommst du über die IT-Seiten der Uni.',
      '很多大学都有 "eduroam" 网络。设置说明和账号信息请看学校 IT 部门的官网。',
      [o('Und wenn es nicht klappt?', '如果连不上呢？', 'help')]),
    help: n('Dann geh zur IT-Beratung bzw. Service-Theke hier im Rechenzentrum – die helfen gern.', '那就去计算中心的 IT 服务台，他们很乐意帮忙。', [BYE]),
  }),
  D('it-cip', ['rrze'], {
    start: n('Im CIP-Pool kannst du an den Uni-Rechnern arbeiten.', '在 CIP-Pool（计算机房）里可以用学校的电脑。',
      [o('Braucht man dafür ein Konto?', '需要账号吗？', 'acc'), BYE]),
    acc: n('Ja, deinen Uni-Account. Wie du ihn einrichtest, steht auf den offiziellen IT-Seiten der FAU.', '需要，用你的学校账号。怎么开通以 FAU IT 官方页面为准。', [o('Okay, danke!', '好的，谢谢！')]),
  }),
  // ---------------- Transport ----------------
  D('bus-city', ['bus', 'any'], {
    start: n('Wartest du auch auf den Bus?', '你也在等公交吗？',
      [o('Ja. Fährt der in die Innenstadt?', '是的，这车去市中心吗？', 'city'), o('Nein, ich schaue nur.', '不，我只是看看。')]),
    city: n('Von hier fahren mehrere Linien Richtung Innenstadt. Fahrpläne findest du in der VGN-App oder an der Haltestelle – die sind aktueller als ich!',
      '这里有好几条线去市中心。时刻表看 VGN 的 App 或站牌——比我记得准！以官方信息为准。',
      [o('Und welches Ticket brauche ich?', '需要买什么票？', 'ticket')]),
    ticket: n('Das hängt davon ab, ob du ein Semesterticket oder Deutschlandticket hast. Preise und Regeln ändern sich – schau auf die offiziellen Seiten.',
      '取决于你有没有学期票或德国票。价格和规定经常变化，以官网为准。', [BYE]),
  }),
  D('bus-altstadt', ['bus', 'any'], {
    start: n('Warst du schon im Schlossgarten in der Innenstadt?', '你去过市中心的宫殿花园（Schlossgarten）吗？',
      [o('Noch nicht. Was gibt es da?', '还没有，那里有什么？', 'what')]),
    what: n('Das Schloss ist heute Sitz der Uni-Verwaltung, dahinter liegt der Schlossgarten. Bei schönem Wetter liegen da viele Studis in der Sonne.',
      '宫殿现在是大学行政办公的地方，后面就是宫殿花园。天气好时很多学生在那里晒太阳。', [o('Da gehe ich mal hin!', '我找时间去看看！')]),
  }),
  // ---------------- Everyday life ----------------
  D('life-sunday', ['any'], {
    start: n('Hast du fürs Wochenende eingekauft?', '你周末的东西买好了吗？',
      [o('Wieso? Am Sonntag gehe ich einkaufen.', '怎么了？我周日去买。', 'sun')]),
    sun: n('Achtung: Sonntags haben die meisten Geschäfte in Bayern geschlossen! Also lieber am Samstag einkaufen.',
      '注意：在巴伐利亚，大多数商店周日不营业！最好周六去买。', [o('Oh, gut zu wissen!', '哦，还好你提醒我！')]),
  }),
  D('life-pfand', ['any'], {
    start: n('Wirf die Flasche nicht weg – da ist Pfand drauf!', '别把瓶子扔了——那是有押金（Pfand）的！',
      [o('Was ist Pfand?', 'Pfand 是什么？', 'what')]),
    what: n('Auf viele Flaschen und Dosen zahlt man Pfand. Im Supermarkt gibt es Automaten, da bekommst du das Geld zurück.',
      '很多瓶子和罐子都付了押金。超市里有回收机，放进去就能拿回押金。具体金额以实际标注为准。', [o('Clever!', '真聪明！')]),
  }),
  D('life-muell', ['any'], {
    start: n('Mülltrennung ist hier ziemlich wichtig.', '在这里垃圾分类挺重要的。',
      [o('Wie trennt man denn?', '怎么分？', 'how')]),
    how: n('Grob: Papier, Verpackungen, Bio, Restmüll – und Glas nach Farben in die Container. Die genauen Regeln stehen bei der Stadt Erlangen.',
      '大致分为：纸类、包装、厨余、其他垃圾——玻璃按颜色扔进回收箱。具体规定以埃尔朗根市政官网为准。', [o('Danke, das ist hilfreich.', '谢谢，很有帮助。')]),
  }),
  D('life-anmeldung', ['any'], {
    start: n('Hast du dich schon in der Stadt angemeldet?', '你已经在市政厅登记住址了吗？',
      [o('Muss ich das?', '必须登记吗？', 'must'), o('Ja, schon erledigt.', '已经办好了。')]),
    must: n('Ja, nach dem Umzug musst du dich beim Bürgeramt anmelden. Termine und Fristen findest du auf der Website der Stadt Erlangen.',
      '是的，搬家后要去市民办公室（Bürgeramt）登记。预约方式和期限以埃尔朗根市官网为准。', [BYE]),
  }),
  D('life-tandem', ['any', 'study'], {
    start: n('Ich suche einen Tandempartner – ich lerne Chinesisch!', '我在找语言搭档（Tandem）——我在学中文！',
      [o('Echt? Ich lerne Deutsch!', '真的？我在学德语！', 'yes'), o('Viel Erfolg dabei!', '祝你成功！')]),
    yes: n('Perfekt! Beim Sprachenzentrum gibt es übrigens Tandem-Angebote. Wollen wir mal einen Kaffee trinken?',
      '太好了！语言中心也有 Tandem 项目。要不要一起喝杯咖啡？', [o('Gerne! Treffen wir uns in der Cafeteria.', '好啊！我们在咖啡角见。')]),
  }),
  D('life-weather-autumn', ['autumn', 'any'], {
    start: n('Typisch Herbst – grau, aber schön bunt, oder?', '典型的秋天——灰蒙蒙的，但颜色很漂亮，对吧？',
      [o('Ja, die Blätter sind toll.', '是啊，树叶很美。', 'leaves')]),
    leaves: n('Pass beim Radfahren auf nasses Laub auf – das ist rutschig wie Eis!', '骑车时小心湿树叶——滑得像冰一样！', [o('Danke für den Tipp!', '谢谢提醒！')]),
  }),
  D('life-rain', ['rain'], {
    start: n('Na, das Wetter heute …', '唉，今天这天气……',
      [o('Ich habe keinen Schirm dabei.', '我没带伞。', 'umb')]),
    umb: n('Hier tragen viele Leute einfach eine Regenjacke – besonders auf dem Rad ist das praktischer.', '这里很多人直接穿雨衣——骑车的时候尤其方便。', [o('Gute Idee.', '好主意。')]),
  }),
  D('life-night', ['night'], {
    start: n('Noch so spät auf dem Campus unterwegs?', '这么晚还在校园里？',
      [o('Ja, ich war in der Bibliothek.', '是的，我刚从图书馆出来。', 'lib'), o('Ich gehe gleich nach Hause.', '我马上回家。', 'home')]),
    lib: n('Fleißig! Komm gut heim – und auf dem Rad: Licht an!', '真用功！回家路上小心——骑车记得开灯！', [o('Mache ich, gute Nacht!', '会的，晚安！')]),
    home: n('Gute Nacht! Die Busse fahren abends seltener, schau lieber vorher in die App.', '晚安！晚上公交班次少，最好提前看看 App。', [o('Danke, gute Nacht!', '谢谢，晚安！')]),
  }),
  D('life-berg', ['any'], {
    start: n('Warst du schon mal auf der Bergkirchweih?', '你去过 Bergkirchweih 吗？',
      [o('Was ist das?', '那是什么？', 'what')]),
    what: n('Ein großes Volksfest in Erlangen mit Bierkellern unter Bäumen, meistens im Frühsommer. Die genauen Termine stehen jedes Jahr auf der Website der Stadt.',
      '埃尔朗根的大型民间节日，在树下的啤酒窖里举行，一般在初夏。每年的具体日期以市政官网为准。', [o('Klingt spannend!', '听起来很有意思！')]),
  }),
  D('life-exam', ['study'], {
    start: n('Hast du dich schon für die Prüfungen angemeldet?', '你已经报名考试了吗？',
      [o('Wann muss man das machen?', '什么时候要报名？', 'when')]),
    when: n('Dafür gibt es feste Anmeldezeiträume. Die Termine stehen im Uni-Portal bzw. beim Prüfungsamt – verpass sie nicht!',
      '有固定的报名时间段。具体日期以学校门户或考试办公室通知为准——别错过了！', [o('Danke, schaue ich gleich nach!', '谢谢，我马上去查！')]),
  }),
  D('staff-help', ['staff'], {
    start: n('Guten Tag! Kann ich Ihnen helfen?', '您好！需要帮忙吗？',
      [o('Wo ist die Mensa?', 'Mensa 在哪儿？', 'mensa'), o('Wo finde ich das Mathegebäude?', '数学楼在哪儿？', 'math')]),
    mensa: n('Die Mensa ist das große Gebäude am Platz an der Erwin-Rommel-Straße. Einfach der Menge folgen!', 'Mensa 就是 Erwin-Rommel-Straße 旁边广场上的那栋大楼。跟着人群走就对了！', [o('Vielen Dank!', '非常感谢！')]),
    math: n('Das Felix-Klein-Gebäude liegt gleich hinter der Mensa, an der Cauerstraße. Tipp: Öffnen Sie die Karte mit „M".',
      'Felix-Klein 楼就在 Mensa 后面，在 Cauerstraße 上。提示：按 "M" 打开地图。', [o('Vielen Dank!', '非常感谢！')]),
  }),
];

// Pick a dialogue suited to the context tags (e.g. ['mensa','autumn']).
export function pickDialogue(tags, r, used = new Set()) {
  const pool = DIALOGUES.filter(d => d.ctx.some(c => tags.includes(c)) && !used.has(d.id));
  const specific = pool.filter(d => d.ctx.some(c => c !== 'any' && tags.includes(c)));
  const src = specific.length && r() < 0.7 ? specific : pool.length ? pool : DIALOGUES;
  return src[Math.floor(r() * src.length)];
}
