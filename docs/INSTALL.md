# 安装与分享

本文给“拿到插件的人”看。插件是 DSH 的**本地 bundle**，不是 npm 包，也不需要构建。

## 直接复制给别人的一段话

```text
这是一个 DSH 截图插件，Windows 10/11 可用。

1. 下载并解压：
   https://github.com/yangmou2004/dsh-screenshot/releases/latest
   下载 dsh-screenshot-1.1.0.zip，解压到固定目录（例如 D:\Tools\dsh-screenshot）
2. 打开 DSH，对智能体说：
   安装本地插件 D:\Tools\dsh-screenshot
   （把路径换成你解压出来的目录）
3. 安装完成后刷新一次 DSH 页面。
4. 输入框左侧会出现相机按钮；也可以直接对 DSH 说“截个全屏”。
```

## 系统要求

- Windows 10 或 Windows 11
- 已安装 DSH Desktop，并能打开 Web GUI
- Windows 自带的 PowerShell 5.1（不需要额外安装）
- 插件在 DSH `0.2.1-rc.2` 上验证；其他版本未验证

## 安装方式 A：从 Release 安装包

1. 打开 [Releases](https://github.com/yangmou2004/dsh-screenshot/releases/latest)
2. 下载 `dsh-screenshot-1.1.0.zip`
3. 解压到固定目录，例如 `D:\Tools\dsh-screenshot`
4. 对 DSH 说：

   > 安装本地插件 `D:\Tools\dsh-screenshot`

5. 刷新 DSH 页面

> 解压后的目录不要删除或移动；插件是链接到该目录的。移动后需要重新安装。

## 安装方式 B：从 GitHub 仓库

```powershell
git clone https://github.com/yangmou2004/dsh-screenshot.git
```

然后对 DSH 说：

> 安装本地插件 `C:\path\to\dsh-screenshot`

或者由智能体调用：

```text
plugin_manager install_bundle target = "C:\path\to\dsh-screenshot"
```

## 验证是否安装成功

- 输入框左侧出现相机图标和 `⌄` 菜单
- 对 DSH 说“截个全屏”，应返回一张截图
- “设置 → 插件”里能看到 `dsh-screenshot-plugin`，状态为启用

## 分享方式

1. **发仓库链接**（适合开发者）  
   <https://github.com/yangmou2004/dsh-screenshot>
2. **发 Release 安装包**（适合普通用户）  
   <https://github.com/yangmou2004/dsh-screenshot/releases/latest>
3. **直接发 zip 文件**  
   把 Release 里的 `dsh-screenshot-1.1.0.zip` 通过微信/QQ/网盘发给对方，对方解压后按上面的步骤安装。

## 注意

- 仅支持 Windows。
- 插件包名是 `dsh-screenshot-plugin`，解压目录名是 `dsh-screenshot`，这是正常的。
- 插件不会把截图上传到任何第三方服务；截图只进入本机 DSH 的对话和（可选的）`screenshots/` 目录。
- 当前没有发布到 npm，也没有进入 DSH 插件市场，所以不能直接 `npm install` 或在市场里搜索。
