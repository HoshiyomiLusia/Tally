import { ArrowLeftRight, BadgePercent, Beer, Bike, Bitcoin, Briefcase, Bus, CalendarClock, Car, CarTaxiFront, ChartCandlestick, ChartNoAxesCombined, ChartPie, CircleHelp, Clapperboard, Coins, ConciergeBell, CupSoda, Film, Folder, Fuel, Gamepad2, Gift, GraduationCap, HandCoins, HandHeart, HeartPulse, House, IdCard, Joystick, Laptop, Lightbulb, Luggage, MicVocal, Package, PartyPopper, Pencil, Pill, Plane, Plug, Printer, ReceiptText, Repeat, RotateCcw, Scale, School, Scissors, ScrollText, Shield, Shirt, ShoppingBag, ShoppingCart, Sofa, Sparkles, SprayCan, SquareParking, Stethoscope, Store, TrainFront, TramFront, TrendingDown, TrendingUp, UsersRound, Utensils, UtensilsCrossed, WashingMachine, Wrench } from "lucide-react";
import type { LucideIcon } from "lucide-react";

// 分类图标: 用 lucide 线描图标替代 emoji(与侧边栏/按钮同一套图形语言, 不受系统 emoji 字体影响).
// 按"分类名"匹配, 不动数据库; 自建分类没匹配上就回退显示原来的 emoji.
// 颜色按顶级分类分配, 长列表里靠色块快速定位是哪一块.
const MAP: [string, LucideIcon, string][] = [
  ["交通", TrainFront, "cyan"],
  ["停车费", SquareParking, "cyan"],
  ["公交", Bus, "cyan"],
  ["共享打车", Car, "cyan"],
  ["出租车", CarTaxiFront, "cyan"],
  ["油费充电", Fuel, "cyan"],
  ["电车地铁", TramFront, "cyan"],
  ["长途", Plane, "cyan"],
  ["其他", Folder, "slate"],
  ["坏账损失", TrendingDown, "slate"],
  ["对账调整", Scale, "slate"],
  ["手续费", BadgePercent, "slate"],
  ["未分类", CircleHelp, "slate"],
  ["固定账单", CalendarClock, "blue"],
  ["会员订阅", Clapperboard, "blue"],
  ["其他固定账单", Repeat, "blue"],
  ["房租", House, "blue"],
  ["水电煤网", Lightbulb, "blue"],
  ["娱乐", Gamepad2, "violet"],
  ["KTV酒吧", MicVocal, "violet"],
  ["展会活动", PartyPopper, "violet"],
  ["旅行", Luggage, "violet"],
  ["游戏充值", Joystick, "violet"],
  ["电影演出", Film, "violet"],
  ["课金打赏", HandHeart, "violet"],
  ["服务", ConciergeBell, "teal"],
  ["API", Plug, "teal"],
  ["学费", School, "teal"],
  ["打印复印", Printer, "teal"],
  ["洗衣干洗", WashingMachine, "teal"],
  ["维修", Wrench, "teal"],
  ["证件办理", IdCard, "teal"],
  ["课程考试", GraduationCap, "teal"],
  ["邮寄快递", Package, "teal"],
  ["生活", HeartPulse, "rose"],
  ["个护", SprayCan, "rose"],
  ["保险", Shield, "rose"],
  ["看病诊断", Stethoscope, "rose"],
  ["美容理发", Scissors, "rose"],
  ["药品", Pill, "rose"],
  ["社交", UsersRound, "pink"],
  ["礼物", Gift, "pink"],
  ["红包转账", HandCoins, "pink"],
  ["请客", Beer, "pink"],
  ["购物", ShoppingBag, "indigo"],
  ["学习用品", Pencil, "indigo"],
  ["家居家具", Sofa, "indigo"],
  ["数码电器", Laptop, "indigo"],
  ["服装鞋帽", Shirt, "indigo"],
  ["生活用品", SprayCan, "indigo"],
  ["饮食", Utensils, "amber"],
  ["便利店", Store, "amber"],
  ["外卖", Bike, "amber"],
  ["线下餐饮", UtensilsCrossed, "amber"],
  ["自动贩卖机", CupSoda, "amber"],
  ["超市", ShoppingCart, "amber"],
  ["账户间转账", Repeat, "slate"],
  ["投资亏损", TrendingDown, "rose"],
  ["工资", Briefcase, "emerald"],
  ["奖学金", GraduationCap, "emerald"],
  ["投资收益", TrendingUp, "emerald"],
  ["报销", ReceiptText, "emerald"],
  ["换汇", ArrowLeftRight, "emerald"],
  ["生活费", House, "emerald"],
  ["红包收入", HandCoins, "emerald"],
  ["退款", RotateCcw, "emerald"],
  ["其他收入", Sparkles, "emerald"],
  // 投资分类树(部分账号有)
  ["投资", ChartNoAxesCombined, "sky"],
  ["股票", ChartCandlestick, "sky"],
  ["基金", ChartPie, "sky"],
  ["加密货币", Bitcoin, "sky"],
  ["债券", ScrollText, "sky"],
  ["其他投资", Coins, "sky"],
  // 账单页对这些交易种类用固定标题, 一并给图标
  ["转账转入", Repeat, "sky"],
  ["转账转出", Repeat, "sky"],
  ["借出", HandCoins, "amber"],
  ["借贷还款", HandCoins, "emerald"],
  ["投资买入", TrendingUp, "sky"],
  ["投资卖出", TrendingDown, "sky"],
];
const BY_NAME = new Map(MAP.map(([n, Icon, color]) => [n, { Icon, color }]));

const TINT: Record<string, string> = {
  cyan: "bg-cyan-500/15 text-cyan-600 dark:text-cyan-300",
  slate: "bg-slate-500/15 text-slate-600 dark:text-slate-300",
  blue: "bg-blue-500/15 text-blue-600 dark:text-blue-300",
  violet: "bg-violet-500/15 text-violet-600 dark:text-violet-300",
  teal: "bg-teal-500/15 text-teal-600 dark:text-teal-300",
  rose: "bg-rose-500/15 text-rose-600 dark:text-rose-300",
  pink: "bg-pink-500/15 text-pink-600 dark:text-pink-300",
  indigo: "bg-indigo-500/15 text-indigo-600 dark:text-indigo-300",
  amber: "bg-amber-500/15 text-amber-600 dark:text-amber-300",
  emerald: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300",
  sky: "bg-sky-500/15 text-sky-600 dark:text-sky-300",
};
const PLAIN: Record<string, string> = {
  cyan: "text-cyan-600 dark:text-cyan-300", slate: "text-slate-500 dark:text-slate-400",
  blue: "text-blue-600 dark:text-blue-300", violet: "text-violet-600 dark:text-violet-300",
  teal: "text-teal-600 dark:text-teal-300", rose: "text-rose-600 dark:text-rose-300",
  pink: "text-pink-600 dark:text-pink-300", indigo: "text-indigo-600 dark:text-indigo-300",
  amber: "text-amber-600 dark:text-amber-300", emerald: "text-emerald-600 dark:text-emerald-300",
  sky: "text-sky-600 dark:text-sky-300",
};

export default function CategoryIcon({
  name, emoji, size = 15, tint = true, className = "",
}: {
  name?: string | null;        // 分类名(匹配依据)
  emoji?: string | null;       // 匹配不上时的回退
  size?: number;               // 图标像素
  tint?: boolean;              // true=浅色圆底, false=只上色不加底
  className?: string;
}) {
  const hit = name ? BY_NAME.get(name) : undefined;
  const box = tint ? Math.round(size * 1.45) : size;
  if (!hit) {
    // 回退: 保持和图标一样的占位宽度, 列表不会因为个别分类没图标而错位
    return (
      <span className={`inline-flex shrink-0 items-center justify-center ${className}`} style={{ width: box, height: box, fontSize: size }}>
        {emoji || ""}
      </span>
    );
  }
  const { Icon, color } = hit;
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center ${tint ? `rounded-md ${TINT[color]}` : PLAIN[color]} ${className}`}
      style={{ width: box, height: box }}
      title={name ?? undefined}
    >
      <Icon size={size} strokeWidth={2} />
    </span>
  );
}
