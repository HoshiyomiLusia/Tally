import Overview from "../components/Overview";
import Stats from "./Stats";

// 首页 = 资产概览 + 统计 (两者定位高度相似, 合并到一页)
export default function Home() {
  return (
    <div>
      <div className="px-4 pt-5 md:px-6">
        <Overview />
      </div>
      <Stats embedded />
    </div>
  );
}
