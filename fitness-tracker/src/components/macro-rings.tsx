"use client";

import { Cell, RadialBar, RadialBarChart, ResponsiveContainer } from "recharts";

type Macro = {
  label: string;
  value: number;
  goal: number;
  unit: string;
  color: string;
  innerRadius: string;
  outerRadius: string;
};

export function MacroRings({
  calories,
  calorieGoal,
  proteinG,
  proteinGoal,
  carbsG,
  fatG,
}: {
  calories: number;
  calorieGoal: number;
  proteinG: number;
  proteinGoal: number;
  carbsG: number;
  fatG: number;
}) {
  const carbsGoal = Math.round((calorieGoal * 0.4) / 4) || 1;
  const fatGoal = Math.round((calorieGoal * 0.25) / 9) || 1;

  const macros: Macro[] = [
    { label: "Calories", value: calories, goal: calorieGoal, unit: "kcal", color: "#10b981", innerRadius: "80%", outerRadius: "100%" },
    { label: "Protein", value: proteinG, goal: proteinGoal, unit: "g", color: "#3b82f6", innerRadius: "58%", outerRadius: "78%" },
    { label: "Carbs", value: carbsG, goal: carbsGoal, unit: "g", color: "#f59e0b", innerRadius: "36%", outerRadius: "56%" },
    { label: "Fat", value: fatG, goal: fatGoal, unit: "g", color: "#ec4899", innerRadius: "14%", outerRadius: "34%" },
  ];

  const chartData = macros.map((m) => ({
    ...m,
    percent: Math.min(100, Math.round((m.value / m.goal) * 100)),
  }));

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="relative aspect-square w-full max-w-[280px]">
        <ResponsiveContainer width="100%" height="100%">
          <RadialBarChart data={chartData} startAngle={90} endAngle={-270}>
            <RadialBar
              dataKey="percent"
              background={{ fill: "rgba(120,120,128,0.14)" }}
              cornerRadius={8}
            >
              {chartData.map((entry) => (
                <Cell key={entry.label} fill={entry.color} />
              ))}
            </RadialBar>
          </RadialBarChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-3xl font-bold text-zinc-900 dark:text-zinc-50">{calories}</span>
          <span className="text-xs text-zinc-500 dark:text-zinc-400">of {calorieGoal} kcal</span>
        </div>
      </div>

      <div className="grid w-full grid-cols-3 gap-2">
        {macros.slice(1).map((m) => (
          <div key={m.label} className="flex flex-col items-center rounded-xl bg-zinc-100 px-2 py-3 dark:bg-zinc-900">
            <span className="h-1.5 w-6 rounded-full" style={{ backgroundColor: m.color }} />
            <span className="mt-1.5 text-sm font-semibold text-zinc-900 dark:text-zinc-50">
              {Math.round(m.value)}
              {m.unit}
            </span>
            <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
              {m.label} / {m.goal}
              {m.unit}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
