# Windows exe 签名流程

适用于本 Electron 项目的 Windows 可执行文件代码签名说明。

---

## 一、整体流程概览

```
购买/申请证书 → 安装证书/配置环境 → 打包生成 exe → 对 exe 签名 → 验证签名
```

---

## 二、证书类型与选择

| 类型 | 说明 | 适用场景 |
|------|------|----------|
| **标准代码签名证书 (Standard)** | 私钥可存本地（.pfx/.p12），成本较低 | 个人/小团队，初次安装可能有 SmartScreen 警告 |
| **EV 代码签名证书 (Extended Validation)** | 私钥必须在硬件令牌（如 USB）中，身份审核更严 | 需要“安装无警告”、快速建立 SmartScreen 信任 |

**注意**：近年规范要求代码签名证书尽量存储在符合标准的硬件中，具体以 CA 要求为准。

---

## 三、证书获取

1. **向 CA 申请**  
   常见提供商：DigiCert、Sectigo、GlobalSign、Comodo 等。  
   - 标准证书：提供企业/个人身份材料，审核通过后下发。  
   - EV 证书：需更严格企业验证，并购买/使用其指定的硬件令牌。

2. **证书形式**  
   - 标准证书：通常提供 `.pfx` 或 `.p12`（含私钥），并设密码。  
   - EV 证书：安装在 USB 令牌中，在签名机器上插着令牌并使用其驱动/工具。

3. **时间戳**  
   签名时必须加时间戳，这样即使证书过期，签名在“签名时刻”仍有效。常用时间戳服务器示例：
   - `http://timestamp.digicert.com`
   - `http://timestamp.sectigo.com`

---

## 四、使用 SignTool 手动签名（通用）

适用于任意已生成的 `.exe`（包括 Electron 打包后的 exe）。

### 4.1 安装 SignTool

- 安装 **Windows SDK**（勾选“Windows 应用签名工具”或“Signing Tools”），或  
- 安装 **Visual Studio** 时勾选“使用 C++ 的桌面开发”，会带 SignTool。

SignTool 典型路径示例：  
`C:\Program Files (x86)\Windows Kits\10\bin\<版本>\x64\signtool.exe`

### 4.2 签名命令示例

**使用 .pfx 文件（标准证书）：**

```powershell
signtool sign ^
  /f "C:\path\to\your-certificate.pfx" ^
  /p "证书密码" ^
  /tr http://timestamp.digicert.com ^
  /td sha256 ^
  /fd sha256 ^
  /v ^
  "你的应用.exe"
```

**使用 EV 证书（证书在系统/令牌中，按主题名指定）：**

```powershell
signtool sign ^
  /n "Your Company Name" ^
  /tr http://timestamp.digicert.com ^
  /td sha256 ^
  /fd sha256 ^
  /v ^
  "你的应用.exe"
```

参数简要说明：

- `/f`：.pfx 文件路径  
- `/p`：.pfx 密码  
- `/n`：证书“主题”中的名称（EV 常用）  
- `/tr`：RFC 3161 时间戳服务器  
- `/td sha256`：时间戳摘要算法  
- `/fd sha256`：文件摘要算法（推荐 SHA256）  
- `/v`：详细输出  

### 4.3 验证签名

```powershell
signtool verify /pa /v "你的应用.exe"
```

或在资源管理器中右键 exe → **属性** → **数字签名** 查看。

---

## 五、在 Electron 项目中自动签名（electron-builder）

若使用 **electron-builder** 打包 Windows 安装包，可在构建时自动签名。

### 5.1 安装 electron-builder

```bash
npm install electron-builder --save-dev
```

### 5.2 在 package.json 中配置 Windows 签名

```json
{
  "build": {
    "appId": "com.yourcompany.electron-app",
    "productName": "ElectronApp",
    "win": {
      "target": ["nsis", "portable"],
      "certificateFile": "path/to/certificate.pfx",
      "certificatePassword": "证书密码",
      "signingHashAlgorithms": ["sha256"],
      "rfc3161TimeStampServer": "http://timestamp.digicert.com"
    }
  }
}
```

**EV 证书**（按主题名，证书在系统/令牌中）：

```json
"win": {
  "target": ["nsis", "portable"],
  "certificateSubjectName": "Your Company Name",
  "signingHashAlgorithms": ["sha256"],
  "rfc3161TimeStampServer": "http://timestamp.digicert.com"
}
```

### 5.3 使用环境变量（推荐，避免证书写进仓库）

**标准证书：**

- `WIN_CSC_LINK`：证书路径或 HTTPS 链接或 base64 编码的证书内容  
- `WIN_CSC_KEY_PASSWORD`：证书密码  

**通用（多平台）：**

- `CSC_LINK`  
- `CSC_KEY_PASSWORD`  

示例（PowerShell）：

```powershell
$env:WIN_CSC_LINK = "C:\path\to\certificate.pfx"
$env:WIN_CSC_KEY_PASSWORD = "你的证书密码"
npm run build
```

### 5.4 打包脚本示例

在 `package.json` 的 `scripts` 中：

```json
"scripts": {
  "build:win": "electron-builder --win",
  "build:win:dir": "electron-builder --win --dir"
}
```

构建产物在 `dist/` 下，安装包和 exe 会按配置自动签名。

---

## 六、本项目的打包方式说明

当前项目使用 **electron-vite** 构建，`package.json` 中暂无 electron-builder。

可选两种方式签名：

1. **先打包出 exe，再用手动签名**  
   - 用 electron-vite 或其他方式生成 exe。  
   - 按第四节用 SignTool 对生成的 exe（及安装包内的 exe）逐个签名。

2. **引入 electron-builder 做 Windows 安装包并自动签名**  
   - 安装并配置 electron-builder。  
   - 在 `build.win` 中配置证书或环境变量，按第五节在构建时自动签名。

---

## 七、检查清单

- [ ] 已从 CA 获取代码签名证书（.pfx 或 EV 硬件令牌）  
- [ ] 签名命令或 electron-builder 中已使用 **SHA256**（/fd sha256、signingHashAlgorithms）  
- [ ] 已配置 **时间戳服务器**（/tr 或 rfc3161TimeStampServer）  
- [ ] 证书、密码仅通过环境变量或安全存储传递，不提交到 Git  
- [ ] 签名后用 `signtool verify` 或资源管理器“数字签名”页验证  

---

## 八、SmartScreen 信誉机制（重要）

Windows SmartScreen 基于**文件哈希**和**签名证书**建立信誉，决定用户下载/运行时是否显示警告。

### 8.1 信誉结果

| 状态 | 表现 |
|------|------|
| **Known Good** | 直接运行，无提示 |
| **Unknown** | 蓝色对话框"Windows 已保护你的电脑" |
| **Known Bad** | 红色警告，阻止运行 |

### 8.2 重要变化（2024+）

> ⚠️ **EV 证书不再享有特殊待遇**  
> 以前 EV 证书可"即时"获得信任，现在**所有证书都需要单独积累信誉**。

### 8.3 建立信誉的最佳实践

1. **长期使用同一证书**：频繁更换证书会重置信誉
2. **签名所有文件类型**：.exe、.dll、.msi、脚本、.cab 等
3. **保持一致的发布者身份**
4. **积累下载量**：信誉随用户下载/运行次数提升

---

## 九、SHA1 vs SHA256（双重签名已过时）

| 时间点 | 变化 |
|--------|------|
| 2016-01-01 | 新签名必须使用 SHA-256，SHA1 签名显示"无效" |
| 2020-01-14 | SHA1 签名完全失效 |
| 2021-01-26 | CA 停止颁发 SHA-1 证书 |

**结论**：现在只需 **SHA-256** 即可，Windows 7+ 原生支持。双重签名（SHA1+SHA256）已无必要。

---

## 十、Azure Trusted Signing（云端签名服务）

微软提供的托管签名服务（原名 Azure Trusted Signing，现称 **Artifact Signing**），无需自行购买和管理证书。

### 10.1 优势

- 无需购买传统 CA 证书
- 私钥托管在 FIPS 140-2 Level 3 认证的 HSM 中
- 内置时间戳服务
- 与 SignTool、GitHub Actions、Azure DevOps、Visual Studio 集成

### 10.2 价格参考（2024）

| 套餐 | 月费 | 包含签名次数 | 超出费用 |
|------|------|--------------|----------|
| Basic | $9.99 | 5,000 次 | $0.005/次 |
| Premium | $99.99 | 100,000 次 | $0.005/次 |

### 10.3 electron-builder 配置示例

```json
"win": {
  "azureSignOptions": {
    "endpoint": "https://eus.codesigning.azure.net",
    "certificateProfileName": "your-profile",
    "codeSigningAccountName": "your-account"
  }
}
```

需配合 Azure AD 身份验证。

---

## 十一、CI/CD 签名最佳实践

### 11.1 GitHub Actions 示例

```yaml
jobs:
  build:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Decode certificate
        run: |
          echo "${{ secrets.WIN_CERTIFICATE_BASE64 }}" | base64 -d > certificate.pfx
        shell: bash
      
      - name: Build and sign
        env:
          WIN_CSC_LINK: certificate.pfx
          WIN_CSC_KEY_PASSWORD: ${{ secrets.WIN_CERTIFICATE_PASSWORD }}
        run: npm run build:win
      
      - name: Clean up certificate
        if: always()
        run: Remove-Item -Path certificate.pfx -ErrorAction SilentlyContinue
```

### 11.2 安全要点

- **证书 Base64 编码**后存入 GitHub Secrets
- **密码单独存储**为 Secret
- 构建完成后**清理临时证书文件**
- 使用 **Environment Secrets** 限制访问范围

### 11.3 证书 Base64 编码

```powershell
# 编码
[Convert]::ToBase64String([IO.File]::ReadAllBytes("certificate.pfx")) | Out-File cert-base64.txt

# 解码（在 CI 中）
[IO.File]::WriteAllBytes("certificate.pfx", [Convert]::FromBase64String($env:WIN_CERTIFICATE_BASE64))
```

---

## 十二、签名顺序（安装包）

对于 NSIS、Inno Setup 等安装包，需要签名多个文件：

```
1. 签名主 exe（如 YourApp.exe）
2. 签名其他 exe/dll（如有）
3. 打包成安装包
4. 签名安装包本身（如 YourApp-Setup.exe）
```

electron-builder 会自动处理这个顺序。手动签名时注意：**先签内容，再打包，最后签安装包**。

---

## 十三、常见问题与排查

### 问题 1：签名后仍显示 SmartScreen 警告

**原因**：证书信誉不足（新证书或新发布者）  
**解决**：
- 继续使用同一证书发布，积累下载量
- 考虑提交到 Microsoft 进行分析：[提交文件](https://www.microsoft.com/wdsi/filesubmission)

### 问题 2：签名失败 - "No certificates were found"

**原因**：证书未正确安装或路径错误  
**解决**：
- 检查 .pfx 路径和密码
- EV 证书：确认 USB 令牌已插入且驱动正常

### 问题 3：时间戳失败

**原因**：网络问题或时间戳服务器不可用  
**解决**：
- 检查网络/防火墙
- 换用其他时间戳服务器

### 问题 4：验证显示"签名损坏"

**原因**：签名后文件被修改，或使用了过时的 SHA1  
**解决**：
- 确保签名后不再修改文件
- 使用 SHA256 算法

---

## 十四、证书续期注意事项

1. **提前续期**：证书过期前 30-60 天开始续期流程
2. **保持同一发布者名称**：有助于继承信誉
3. **时间戳的重要性**：有时间戳的签名在证书过期后仍然有效
4. **更新 CI/CD 配置**：新证书需更新 Secrets

---

## 十五、成本参考（2024）

| 类型 | 大致年费 | 备注 |
|------|----------|------|
| 标准代码签名证书 | $200-400 | 需自行保管私钥 |
| EV 代码签名证书 | $400-600 | 含硬件令牌首年费用 |
| Azure Trusted Signing | $120-1200 | 按使用量，无需管理证书 |

> 注：价格因 CA 和促销而异，仅供参考。

---

## 十六、参考链接

- [Microsoft - SignTool](https://learn.microsoft.com/en-us/windows/win32/seccrypto/signtool)  
- [Microsoft - Use SignTool to sign a file](https://learn.microsoft.com/en-us/windows/win32/seccrypto/using-signtool-to-sign-a-file)  
- [electron-builder - Windows 代码签名](https://www.electron.build/code-signing-win.html)  
- [Azure Trusted Signing](https://azure.microsoft.com/en-us/products/trusted-signing)  
- [SmartScreen AppRep 最佳实践](https://textslashplain.com/2024/11/15/best-practices-for-smartscreen-apprep/)  
