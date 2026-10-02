@echo off
setlocal enabledelayedexpansion

echo ========================================================
echo   AI Voice Agent - Android APK Local Builder
echo ========================================================

set "JAVA_HOME=C:\Users\User\jdk17.0.20_12"
set "ANDROID_HOME=C:\Users\User\AppData\Local\Android\Sdk"
set "PATH=%JAVA_HOME%\bin;%ANDROID_HOME%\platform-tools;%PATH%"

echo [*] Using Java: %JAVA_HOME%
echo [*] Using Android SDK: %ANDROID_HOME%

cd /d "c:\voice agenty\VoiceAgentApp\android"

echo [*] Building Android Release APK with standalone offline JS bundle...
call gradlew.bat assembleRelease --no-daemon

if %ERRORLEVEL% EQU 0 (
    echo [OK] Gradle build successful!
    if exist "app\build\outputs\apk\release\app-release.apk" (
        copy /y "app\build\outputs\apk\release\app-release.apk" "c:\voice agenty\AI-Voice-Agent.apk"
        echo [OK] Standalone APK copied to: c:\voice agenty\AI-Voice-Agent.apk
    ) else if exist "app\build\outputs\apk\debug\app-debug.apk" (
        copy /y "app\build\outputs\apk\debug\app-debug.apk" "c:\voice agenty\AI-Voice-Agent.apk"
        echo [OK] Standalone APK copied to: c:\voice agenty\AI-Voice-Agent.apk
    )
) else (
    echo [!] Release build failed, trying Debug APK build...
    call gradlew.bat assembleDebug --no-daemon
    if exist "app\build\outputs\apk\debug\app-debug.apk" (
        copy /y "app\build\outputs\apk\debug\app-debug.apk" "c:\voice agenty\AI-Voice-Agent.apk"
        echo [OK] Standalone APK copied to: c:\voice agenty\AI-Voice-Agent.apk
    )
)

echo ========================================================
