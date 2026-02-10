# macOS 签名流程

适用于本 Electron 项目的 macOS 应用签名与公证说明。

---

## 一、整体流程概览

```
加入 Apple Developer Program → 创建证书 → 签名应用 → 公证 (Notarization) → 分发
```

macOS 签名比 Windows 多一步**公证 (Notarization)**，这是 Apple 要求的恶意软件检查。

---

## 二、前提条件

| 要求 | 说明 |
|------|------|
| **Apple Developer Program** | 年费 $99，必须加入才能获得 Developer ID 证书 |
| **macOS 开发机** | 用于创建证书和导出 |
| **Xcode 14+** | 包含 `codesign` 和 `notarytool` 工具 |

---

## 三、证书类型

| 证书类型 | 用途 |
|----------|------|
| **Developer ID Application** | 签名 .app 应用，用于 App Store **外**分发 |
| **Developer ID Installer** | 签名 .pkg 安装包 |
| **Mac App Distribution** | 用于 Mac App Store 分发 |
| **Mac Installer Distribution** | 用于 Mac App Store 的安装包 |

> 常见场景（非 App Store 分发）：需要 **Developer ID Application** + **Developer ID Installer**（如果打包 .pkg）

---

## 四、创建和导出证书

### 4.1 在 Apple Developer 网站创建

1. 登录 [Apple Developer](https://developer.apple.com/account)
2. 进入 **Certificates, Identifiers & Profiles**
3. 点击 **Certificates** → **+** 创建新证书
4. 选择 **Developer ID Application**（或 Installer）
5. 按提示上传 CSR（Certificate Signing Request），下载证书

### 4.2 在 Keychain 中导出 .p12

1. 双击下载的 `.cer` 文件，导入到 Keychain
2. 打开 **钥匙串访问 (Keychain Access)**
3. 选择 **登录 (login)** 钥匙串 → **我的证书 (My Certificates)**
4. 找到 **Developer ID Application: Your Name (TEAM_ID)**
5. 右键 → **导出**，保存为 `.p12` 格式，设置密码

---

## 五、Hardened Runtime 和 Entitlements

### 5.1 Hardened Runtime（必需）

macOS 公证**强制要求**启用 Hardened Runtime。签名时必须加 `--options=runtime`。

### 5.2 Entitlements（权限声明）

Electron 应用通常需要以下 entitlements，创建 `entitlements.mac.plist`：

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>com.apple.security.cs.allow-jit</key>
    <true/>
    <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
    <true/>
    <key>com.apple.security.cs.allow-dyld-environment-variables</key>
    <true/>
</dict>
</plist>
```

常用 entitlements 说明：

| Key | 说明 |
|-----|------|
| `com.apple.security.cs.allow-jit` | 允许 JIT 编译（V8 引擎需要） |
| `com.apple.security.cs.allow-unsigned-executable-memory` | 允许未签名的可执行内存 |
| `com.apple.security.cs.allow-dyld-environment-variables` | 允许 DYLD 环境变量 |
| `com.apple.security.device.audio-input` | 访问麦克风 |
| `com.apple.security.device.camera` | 访问摄像头 |

---

## 六、手动签名与公证

### 6.1 签名命令

```bash
# 签名 .app
codesign --force \
  --options=runtime \
  --entitlements entitlements.mac.plist \
  --sign "Developer ID Application: Your Name (TEAM_ID)" \
  --timestamp \
  YourApp.app

# 验证签名
codesign --verify --deep --strict --verbose=2 YourApp.app

# 检查 Gatekeeper
spctl --assess --type execute --verbose YourApp.app
```

### 6.2 公证流程（notarytool）

> ⚠️ 自 2023 年 11 月起，`altool` 已弃用，必须使用 `notarytool`

**步骤 1：创建 App-Specific Password**

1. 访问 [appleid.apple.com](https://appleid.apple.com)
2. 登录 → **App 专用密码** → 生成

**步骤 2：存储凭据到 Keychain（推荐）**

```bash
xcrun notarytool store-credentials "notary-profile" \
  --apple-id "your@email.com" \
  --team-id "TEAM_ID" \
  --password "app-specific-password"
```

**步骤 3：压缩并提交公证**

```bash
# 压缩 .app 为 zip
ditto -c -k --keepParent YourApp.app YourApp.zip

# 提交公证
xcrun notarytool submit YourApp.zip \
  --keychain-profile "notary-profile" \
  --wait

# 或使用 Apple ID 直接提交
xcrun notarytool submit YourApp.zip \
  --apple-id "your@email.com" \
  --team-id "TEAM_ID" \
  --password "app-specific-password" \
  --wait
```

**步骤 4：Staple 公证票据**

```bash
xcrun stapler staple YourApp.app
```

### 6.3 公证 .pkg 安装包

```bash
# 创建 .pkg
productbuild --sign "Developer ID Installer: Your Name (TEAM_ID)" \
  --component YourApp.app /Applications \
  YourApp.pkg

# 提交公证
xcrun notarytool submit YourApp.pkg \
  --keychain-profile "notary-profile" \
  --wait

# Staple
xcrun stapler staple YourApp.pkg
```

---

## 七、在 Electron 项目中自动签名（electron-builder）

### 7.1 安装依赖

```bash
npm install electron-builder --save-dev
```

### 7.2 package.json 配置

```json
{
  "build": {
    "appId": "com.yourcompany.electron-app",
    "productName": "ElectronApp",
    "mac": {
      "target": ["dmg", "zip"],
      "category": "public.app-category.developer-tools",
      "hardenedRuntime": true,
      "gatekeeperAssess": false,
      "entitlements": "build/entitlements.mac.plist",
      "entitlementsInherit": "build/entitlements.mac.plist",
      "identity": "Developer ID Application: Your Name (TEAM_ID)"
    },
    "dmg": {
      "sign": false
    },
    "afterSign": "scripts/notarize.js"
  }
}
```

### 7.3 公证脚本 (scripts/notarize.js)

```javascript
const { notarize } = require('@electron/notarize');
const path = require('path');

exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context;
  
  if (electronPlatformName !== 'darwin') {
    return;
  }

  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(appOutDir, `${appName}.app`);

  console.log(`Notarizing ${appPath}...`);

  await notarize({
    appPath,
    appleId: process.env.APPLE_ID,
    appleIdPassword: process.env.APPLE_ID_PASSWORD,
    teamId: process.env.APPLE_TEAM_ID,
  });

  console.log('Notarization complete!');
};
```

安装公证依赖：

```bash
npm install @electron/notarize --save-dev
```

### 7.4 环境变量

**方式 1：Apple ID + App-Specific Password**

```bash
export APPLE_ID="your@email.com"
export APPLE_ID_PASSWORD="app-specific-password"
export APPLE_TEAM_ID="TEAM_ID"
```

**方式 2：API Key（推荐用于 CI/CD）**

```bash
export APPLE_API_KEY="AuthKey_XXXXXX.p8"
export APPLE_API_KEY_ID="XXXXXX"
export APPLE_API_ISSUER="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

**方式 3：Keychain Profile**

```bash
export APPLE_KEYCHAIN_PROFILE="notary-profile"
```

### 7.5 CI/CD 证书配置

```bash
# 证书 Base64 编码
export CSC_LINK="base64-encoded-p12-content"
export CSC_KEY_PASSWORD="p12-password"

# 或使用文件路径 / HTTPS 链接
export CSC_LINK="https://example.com/cert.p12"
```

---

## 八、electron-builder 内置公证（简化方式）

electron-builder 现已内置公证支持，可省略自定义脚本：

```json
{
  "build": {
    "mac": {
      "hardenedRuntime": true,
      "entitlements": "build/entitlements.mac.plist",
      "entitlementsInherit": "build/entitlements.mac.plist",
      "notarize": {
        "teamId": "TEAM_ID"
      }
    }
  }
}
```

配合环境变量 `APPLE_ID`、`APPLE_ID_PASSWORD`（或 API Key）自动完成公证。

---

## 九、GitHub Actions CI/CD 示例

```yaml
name: Build macOS

on:
  push:
    branches: [main]

jobs:
  build:
    runs-on: macos-latest
    
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Import certificate
        env:
          CERTIFICATE_BASE64: ${{ secrets.MAC_CERTIFICATE_BASE64 }}
          CERTIFICATE_PASSWORD: ${{ secrets.MAC_CERTIFICATE_PASSWORD }}
        run: |
          # 创建临时钥匙串
          KEYCHAIN_PATH=$RUNNER_TEMP/build.keychain
          KEYCHAIN_PASSWORD=$(openssl rand -base64 32)
          
          security create-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN_PATH"
          security set-keychain-settings -lut 21600 "$KEYCHAIN_PATH"
          security unlock-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN_PATH"
          
          # 导入证书
          echo "$CERTIFICATE_BASE64" | base64 --decode > certificate.p12
          security import certificate.p12 -P "$CERTIFICATE_PASSWORD" \
            -A -t cert -f pkcs12 -k "$KEYCHAIN_PATH"
          security list-keychain -d user -s "$KEYCHAIN_PATH"
          
          # 允许 codesign 访问
          security set-key-partition-list -S apple-tool:,apple: \
            -s -k "$KEYCHAIN_PASSWORD" "$KEYCHAIN_PATH"
          
          rm certificate.p12
      
      - name: Build and notarize
        env:
          APPLE_ID: ${{ secrets.APPLE_ID }}
          APPLE_ID_PASSWORD: ${{ secrets.APPLE_ID_PASSWORD }}
          APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}
        run: npm run build:mac
      
      - name: Upload artifact
        uses: actions/upload-artifact@v4
        with:
          name: mac-build
          path: dist/*.dmg
```

---

## 十、常见问题与排查

### 问题 1：公证失败 - "The signature of the binary is invalid"

**原因**：未启用 Hardened Runtime 或 entitlements 配置错误  
**解决**：
- 确保 `hardenedRuntime: true`
- 检查 entitlements.plist 是否正确

### 问题 2：公证失败 - "The executable does not have the hardened runtime enabled"

**原因**：Electron 内部的 Helper 应用未正确签名  
**解决**：electron-builder 会自动处理，确保使用最新版本

### 问题 3：Gatekeeper 拒绝 - "App is damaged"

**原因**：公证票据未 staple，或下载时被隔离  
**解决**：
```bash
# 重新 staple
xcrun stapler staple YourApp.app

# 或用户手动解除隔离（开发调试用）
xattr -cr YourApp.app
```

### 问题 4：公证日志查看

```bash
# 获取提交 ID 后查看日志
xcrun notarytool log <submission-id> --keychain-profile "notary-profile"
```

### 问题 5：CI 中签名失败 - "no identity found"

**原因**：证书未正确导入或钥匙串未解锁  
**解决**：
- 检查 Base64 编码是否完整
- 确保 `security unlock-keychain` 已执行
- 检查 `security set-key-partition-list` 允许 codesign 访问

---

## 十一、证书有效期与续期

| 证书类型 | 有效期 | 过期后影响 |
|----------|--------|------------|
| Developer ID Application | 5 年 | 已签名的应用仍可运行，但无法签新版本 |
| Developer ID Installer | 5 年 | .pkg 无法安装，需重新签名 |

**续期建议**：
- 证书过期前创建新证书
- 更新 CI/CD 中的证书配置
- 旧应用无需重新签名（只要未吊销）

---

## 十二、本项目的 macOS 签名方式

当前项目使用 **electron-vite** 构建，可选：

1. **引入 electron-builder**
   - 添加 electron-builder 配置
   - 设置 `mac` 节点，启用 `hardenedRuntime` 和 `notarize`
   - 配置环境变量

2. **手动签名**
   - 先用 electron-vite 打包出 .app
   - 用 `codesign` 签名
   - 用 `notarytool` 公证

---

## 十三、检查清单

- [ ] 已加入 Apple Developer Program ($99/年)
- [ ] 已创建 Developer ID Application 证书
- [ ] 已导出 .p12 文件（CI/CD 用）
- [ ] 已创建 App-Specific Password（公证用）
- [ ] 配置了 `hardenedRuntime: true`
- [ ] 创建了 `entitlements.mac.plist`
- [ ] 公证完成后已 staple 票据
- [ ] 证书、密码通过环境变量/Secrets 传递

---

## 十四、成本参考

| 项目 | 费用 |
|------|------|
| Apple Developer Program | $99/年 |
| Developer ID 证书 | 包含在会员资格内 |
| 公证服务 | 免费 |

---

## 十五、参考链接

- [Apple - Developer ID](https://developer.apple.com/support/developer-id/)
- [Apple - Notarizing macOS Software](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution)
- [Apple - Hardened Runtime](https://developer.apple.com/documentation/security/hardened-runtime)
- [electron-builder - macOS 签名](https://www.electron.build/code-signing-mac.html)
- [@electron/notarize](https://www.npmjs.com/package/@electron/notarize)
