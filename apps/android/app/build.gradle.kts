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
        buildConfigField("boolean", "GOOGLE_MAPS_CONFIGURED", googleMapsApiKey.isNotEmpty().toString())
        buildConfigField("String", "API_BASE_URL", "\"https://api.lycoris-map.com/\"")
        buildConfigField("boolean", "TEST_ENVIRONMENT", "false")
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
