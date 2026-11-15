import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.chagok.car"
    compileSdk = 36

    // AAOS 표준 Car API(CarPropertyManager, CarUxRestrictionsManager)로 시동·기어·주행 제한을 읽는다.
    useLibrary("android.car")

    defaultConfig {
        applicationId = "com.chagok.car"
        // Pleos Connect 요구사항: minSdk 28 이상, 플랫폼은 API 34
        minSdk = 28
        targetSdk = 34
        versionCode = 5
        versionName = "0.3.0"
        testInstrumentationRunner = "com.chagok.car.E2eRunner"
    }

    buildFeatures {
        buildConfig = true
    }

    buildTypes {
        debug {
            // 에뮬레이터에서 PC의 서버(pnpm server:dev)에 붙는 주소. 포트는 -Pchagok.serverPort=<포트>로 바꿀 수 있다(기본 8787).
            val serverPortValue = (project.findProperty("chagok.serverPort") as String?) ?: "8787"
            val serverPort = serverPortValue.toIntOrNull()?.takeIf { it in 1..65535 }
                ?: throw GradleException("chagok.serverPort는 1~65535 사이 숫자여야 합니다: $serverPortValue")
            buildConfigField("String", "SERVER_URL", "\"http://10.0.2.2:$serverPort\"")
        }
        release {
            isMinifyEnabled = false
            buildConfigField("String", "SERVER_URL", "\"https://chagok.invalid\"")
        }
    }

    sourceSets {
        // JVM 단위 테스트와 계측 테스트가 같은 픽스처(저장소 루트 fixtures/)와 도우미를 쓴다.
        getByName("test") {
            java.srcDir("src/sharedTest/java")
            resources.srcDir("../../fixtures")
        }
        getByName("androidTest") {
            java.srcDir("src/sharedTest/java")
            assets.srcDir("../../fixtures")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_17)
    }
}

dependencies {
    implementation("ai.pleos.playground:Vehicle:2.3.2")
    implementation("ai.pleos.playground:NaviHelper:3.0.5")
    implementation("ai.pleos.playground:FusedLocation:1.1.3")
    implementation("ai.pleos.playground:TextToSpeech:3.3.1")
    implementation("ai.pleos.playground:SpeechToText:3.3.1")
    // 차–폰 연결 카드의 QR 그림(인코더만, 카메라·스캔 없음)
    implementation("com.google.zxing:core:3.5.3")

    testImplementation("junit:junit:4.13.2")
    // JVM 단위 테스트(SnapshotCodec)는 android.jar의 org.json 스텁 대신 이 구현을 쓴다
    testImplementation("org.json:json:20231013")

    androidTestImplementation("androidx.test:runner:1.6.2")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
    androidTestImplementation("androidx.test.uiautomator:uiautomator:2.3.0")
}
