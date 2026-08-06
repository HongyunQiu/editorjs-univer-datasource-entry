@echo off
setlocal enabledelayedexpansion

echo Building editorjs-univer-datasource-entry...

if not exist "node_modules\vite" (
    echo vite dependency not found. Running npm install...
    call npm install
    set INSTALL_RESULT=!ERRORLEVEL!
    if !INSTALL_RESULT! NEQ 0 (
        echo npm install failed with code !INSTALL_RESULT!
        exit /b !INSTALL_RESULT!
    )
)

call npm run build
set BUILD_RESULT=!ERRORLEVEL!

echo.
echo Build finished with code !BUILD_RESULT!

if !BUILD_RESULT! NEQ 0 (
    echo Build failed with code !BUILD_RESULT!
    exit /b !BUILD_RESULT!
)

if not exist "dist\univerDatasourceEntry.umd.js" (
    echo Missing file: dist\univerDatasourceEntry.umd.js
    exit /b 1
)

if not exist "dist\univerDatasourceEntry.mjs" (
    echo Missing file: dist\univerDatasourceEntry.mjs
    exit /b 1
)

if not exist "..\..\QNotes\public\vendor\editorjs-univer-datasource-entry" (
    echo Creating target directory...
    mkdir "..\..\QNotes\public\vendor\editorjs-univer-datasource-entry"
    set MKDIR_RESULT=!ERRORLEVEL!
    if !MKDIR_RESULT! NEQ 0 (
        echo Failed to create target directory. Code !MKDIR_RESULT!
        exit /b !MKDIR_RESULT!
    )
)

echo Copying dist files...
copy /Y "dist\univerDatasourceEntry.umd.js" "..\..\QNotes\public\vendor\editorjs-univer-datasource-entry\univerDatasourceEntry.umd.js" >nul
set COPY_UMD_RESULT=!ERRORLEVEL!
if !COPY_UMD_RESULT! NEQ 0 (
    echo Failed to copy univerDatasourceEntry.umd.js. Code !COPY_UMD_RESULT!
    exit /b !COPY_UMD_RESULT!
)

copy /Y "dist\univerDatasourceEntry.mjs" "..\..\QNotes\public\vendor\editorjs-univer-datasource-entry\univerDatasourceEntry.mjs" >nul
set COPY_MJS_RESULT=!ERRORLEVEL!
if !COPY_MJS_RESULT! NEQ 0 (
    echo Failed to copy univerDatasourceEntry.mjs. Code !COPY_MJS_RESULT!
    exit /b !COPY_MJS_RESULT!
)

echo.
echo ========================================
echo editorjs-univer-datasource-entry build and copy completed successfully.
echo ========================================

exit /b 0
