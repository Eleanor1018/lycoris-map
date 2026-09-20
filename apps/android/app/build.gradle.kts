import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.ksp)
}

// SDK keys ship in the manifest; restrict them to the Android package and certificate in Google Cloud.
// The local file is ignored and CI can supply the environment variable without committing a key.
val mapSecrets = Properties().apply {
    rootProject.file("local.secrets.properties").takeIf { it.isFile }?.inputStream()?.use { load(it) }
}
val googleMapsApiKey = providers.environmentVariable("LYCORIS_GOOGLE_MAPS_API_KEY")
    .orElse(providers.gradleProperty("lycoris.googleMapsApiKey")).orNull?.trim()
    ?: mapSecrets.getProperty("googleMapsApiKey", "").trim()
require(googleMapsApiKey.isEmpty() || googleMapsApiKey.matches(Regex("[A-Za-z0-9_-]+"))) {
    "Google Maps key contains invalid characters"
}
val tencentMapsApiKey = providers.environmentVariable("LYCORIS_TENCENT_MAPS_API_KEY")
    .orElse(providers.gradleProperty("lycoris.tencentMapsApiKey")).orNull?.trim()
    ?: mapSecrets.getProperty("tencentMapsApiKey", "").trim()
require(tencentMapsApiKey.isEmpty() || tencentMapsApiKey.matches(Regex("[A-Za-z0-9_-]+"))) {
    "Tencent Maps key contains invalid characters"
}

// Only a path belongs in local.properties; the key and passwords stay outside source control.
// CI without this optional configuration continues producing an unsigned release artifact.
val localBuildProperties = Properties().apply {
    rootProject.file("local.properties").takeIf { it.isFile }?.inputStream()?.use { load(it) }
}
val releaseSigningPath = providers.environmentVariable("LYCORIS_ANDROID_SIGNING_PROPERTIES")
    .orElse(providers.gradleProperty("lycoris.signingProperties")).orNull
    ?: localBuildProperties.getProperty("lycoris.signingProperties")
val releaseSigningProperties = releaseSigningPath?.let { path ->
    require(path.isNotBlank()) { "Release signing properties path must not be blank" }
    val credentialsFile = rootProject.file(path)
    require(credentialsFile.isFile) { "Release signing properties file was not found" }
    Properties().apply {
        credentialsFile.inputStream().use { load(it) }
        for (name in listOf("storeFile", "storePassword", "keyAlias", "keyPassword")) {
            require(!getProperty(name).isNullOrBlank()) { "Release signing requires $name" }
        }
        require(rootProject.file(getProperty("storeFile")).isFile) { "Release keystore was not found" }
    }
}

android {
    namespace = "com.lycoris.maps"
    compileSdk = 37
    defaultConfig {
        applicationId = "com.lycoris.maps"
        minSdk = 26
        targetSdk = 37
        versionCode = 1
        versionName = "0.1.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        manifestPlaceholders["googleMapsApiKey"] = googleMapsApiKey
        manifestPlaceholders["tencentMapsApiKey"] = tencentMapsApiKey
        buildConfigField("boolean", "TENCENT_MAPS_CONFIGURED", tencentMapsApiKey.isNotEmpty().toString())
        buildConfigField("boolean", "GOOGLE_MAPS_CONFIGURED", googleMapsApiKey.isNotEmpty().toString())
        buildConfigField("String", "API_BASE_URL", "\"https://api.lycoris-map.com/\"")
        buildConfigField("boolean", "TEST_ENVIRONMENT", "false")
    }
    signingConfigs {
        releaseSigningProperties?.let { credentials ->
            create("release") {
                storeFile = rootProject.file(credentials.getProperty("storeFile"))
                storePassword = credentials.getProperty("storePassword")
                keyAlias = credentials.getProperty("keyAlias")
                keyPassword = credentials.getProperty("keyPassword")
            }
        }
    }
    buildTypes {
        debug {
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
            resValue("string", "app_name", "Lycoris Dev")
        }
        create("qa") {
            initWith(getByName("debug"))
            applicationIdSuffix = ".qa"
            versionNameSuffix = "-qa"
            resValue("string", "app_name", "Lycoris QA")
            matchingFallbacks += "debug"
            buildConfigField("String", "API_BASE_URL", "\"http://10.0.2.2:18187/\"")
            buildConfigField("boolean", "TEST_ENVIRONMENT", "true")
        }
        release {
            if (releaseSigningProperties != null) signingConfig = signingConfigs.getByName("release")
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
        create("preview") {
            initWith(getByName("release"))
            applicationIdSuffix = ".preview"
            versionNameSuffix = "-preview"
            resValue("string", "app_name", "Lycoris Preview")
            signingConfig = signingConfigs.getByName("debug")
            matchingFallbacks += "release"
        }
    }
    testBuildType = "qa"
    buildFeatures {
        compose = true
        buildConfig = true
        resValues = true
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    testOptions { unitTests.isIncludeAndroidResources = true }
    packaging { resources.excludes += "/META-INF/{AL2.0,LGPL2.1}" }
}

ksp { arg("room.schemaLocation", "$projectDir/schemas") }

dependencies {
    implementation(libs.androidx.core)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(platform(libs.compose.bom))
    implementation(libs.compose.ui)
    implementation(libs.compose.preview)
    implementation(libs.compose.material3)
    implementation(libs.compose.icons)
    implementation(libs.maplibre)
    implementation(libs.google.maps)
    implementation(libs.tencent.maps)
    implementation(libs.tencent.foundation)
    implementation(libs.coroutines.android)
    implementation(libs.serialization.json)
    implementation(libs.okhttp)
    implementation(libs.retrofit)
    implementation(libs.retrofit.serialization)
    implementation(libs.coil.compose)
    implementation(libs.coil.network)
    implementation(libs.coil.svg)
    implementation(libs.datastore)
    implementation(libs.room.runtime)
    implementation(libs.room.ktx)
    ksp(libs.room.compiler)
    implementation(libs.work.runtime)
    implementation(libs.exif)
    debugImplementation(libs.compose.tooling)
    debugImplementation(libs.compose.test.manifest)
    "qaImplementation"(libs.compose.tooling)
    "qaImplementation"(libs.compose.test.manifest)
    testImplementation(libs.junit)
    testImplementation(libs.coroutines.test)
    testImplementation(libs.mockwebserver)
    androidTestImplementation(platform(libs.compose.bom))
    androidTestImplementation(libs.compose.test)
    androidTestImplementation(libs.androidx.test.junit)
    androidTestImplementation(libs.androidx.test.runner)
    // Compose's older transitive Espresso uses reflection removed in Android 17.
    androidTestImplementation(libs.androidx.test.espresso)
    androidTestImplementation(libs.work.testing)
}
