# 我的足迹地图（Travel Footprint Map）

> 仓库名 `test-blog-bilibili` 是历史遗留，实际内容是一个纯前端的旅行足迹地图应用，与博客 / B 站无关。

在中国地图或世界地图上点亮自己去过的城市、省份和国家。支持同一账号下多个成员（比如家人）各自记录，用不同颜色区分；登录后数据自动同步到云端。

在线地址（GitHub Pages）：https://marcus0729.github.io/test-blog-bilibili/

## 功能

- **中国地图**，三种点亮模式：
  - 普通模式：标注到访城市
  - 省份点亮：按省级边界高亮到访过的省份（直辖市整体高亮）
  - 仅点亮城市：按真实地级市边界高亮，可直接点击地图选择城市，自动聚焦到访城市
- **世界地图**：按国家真实边界高亮（点亮中国时台湾、香港、澳门一并点亮）
- **多成员**：同一账号下添加多个成员，每人的到访记录独立、颜色可自定义
- **账号与云同步**：邮箱 + 密码注册登录，数据保存到 Supabase；不登录也能用，数据只存在本机浏览器（localStorage）
- 登录时若本机和云端都有数据，会弹窗让你选择保留哪一份

## 技术栈

- 纯静态页面：HTML + CSS + 原生 JavaScript，无需构建
- [ECharts](https://echarts.apache.org/) 绘制地图（`js/vendor/echarts.min.js`）
- [Supabase](https://supabase.com/) 提供账号认证和数据库（`js/vendor/supabase.js`）
- GitHub Actions 推送到 `main` 后自动部署到 GitHub Pages（`.github/workflows/deploy-pages.yml`）

## 目录结构

```
index.html                  页面结构（顶栏、登录弹窗、成员管理弹窗、侧边栏）
css/style.css               样式
js/app.js                   主逻辑：地图渲染、点亮模式、成员管理、登录与云同步
js/supabase-config.js       Supabase 项目地址与 anon key
js/cities-data.js           中国城市列表
js/province-labels-data.js  省份标签坐标
js/countries-data.js        国家列表
data/china.json             中国省级边界 GeoJSON
data/china-cities.json      中国地级市边界 GeoJSON
data/world.json             世界国家边界 GeoJSON
```

## 本地运行

GeoJSON 通过 `fetch` 加载，需要用本地服务器打开，不能直接双击 `index.html`：

```bash
python3 -m http.server 8000
# 然后访问 http://localhost:8000
```

## 云端数据（Supabase）

- 项目地址见 `js/supabase-config.js`（项目 ref：`eonzswndrzvxzbkwhjwu`）
- 账号由 Supabase Auth 管理（邮箱 + 密码）
- 到访数据存在表 `travel_data` 中，每个账号一行：

| 列 | 说明 |
| --- | --- |
| `user_id` | 对应 Supabase Auth 用户 id（主键） |
| `members` | JSON 数组：每个成员的 `id`、`name`、`color`、`visitedCities`、`visitedCountries` |
| `visited_cities` / `visited_countries` | 旧版（多成员之前）的字段，仅用于兼容迁移 |
| `updated_at` | 最后同步时间 |

前端里的 anon key 是公开的，数据访问权限靠该表的 Row Level Security 策略保证（每个用户只能读写自己的那一行）。

## 忘记账号或密码怎么办

应用目前**没有**"忘记密码"入口，而且密码在 Supabase 中是加密哈希保存的，任何人（包括项目所有者）都无法查看原密码，只能重置。

作为 Supabase 项目所有者，可以这样找回：

1. 登录 [Supabase 控制台](https://supabase.com/dashboard)，进入本项目（ref `eonzswndrzvxzbkwhjwu`）。
2. 左侧 **Authentication → Users**，在列表中找到自己的邮箱（忘记用的是哪个邮箱也可以在这里看到全部注册账号）。
3. 重置密码，任选其一：
   - **推荐**：在该用户详情里直接设置一个新密码；
   - 或者点 **Send password recovery** 发送重置邮件。注意应用里还没有"设置新密码"的页面，点邮件链接只会让你直接登录进应用；而且链接跳转地址取决于 **Authentication → URL Configuration** 里的 Site URL，需要设为上面的在线地址。
4. 用新密码在应用里登录，到访数据存在 `travel_data` 表里，不会因为重置密码而丢失。

如果连 Supabase 控制台也登不上，先通过 Supabase 自身的登录页找回 Supabase 账号（通常是用 GitHub 登录的）。
