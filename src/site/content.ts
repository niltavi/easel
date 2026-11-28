import type {Locale} from "./routes.ts";

export const siteCopy = {
  en: {
    title: "Easel — A personal whiteboard",
    heading: "A personal whiteboard",
    description: "Sketch by hand, arrange shapes, and connect ideas on an infinite canvas that works offline.",
    open: "Open whiteboard",
    install: "Installation guide for agents",
    signIn: "Sign in",
    language: "Language",
    dark: "Switch to dark theme",
    light: "Switch to light theme",
    github: "GitHub repository",
  },
  "zh-CN": {
    title: "Easel — 个人画板",
    heading: "个人画板",
    description: "在无限画布上手写、摆放形状、连接想法。断网也可以继续画。",
    open: "打开画板",
    install: "给 Agent 的安装指南",
    signIn: "登录",
    language: "语言",
    dark: "切换深色主题",
    light: "切换浅色主题",
    github: "GitHub 仓库",
  },
} satisfies Record<Locale, Record<string, string>>;
