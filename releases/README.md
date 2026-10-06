# 本地发布包

每个版本使用单独的目录，例如 `v1.1.0/`，内含静态网页 ZIP 和 `SHA256SUMS.txt`。发布包本身忽略提交，上传到 GitHub Release。

在项目根目录运行：

```powershell
npm run build:static
pwsh -File scripts/package-release.ps1
```

打包脚本从 `package.json` 读取版本号，仅收集 `out/mugao/`、静态包使用说明和许可证。
