package com.chagok.car

/** 테스트 리소스로 들어온 fixtures/ 아래 파일 내용 */
object FixtureFile {
    fun read(path: String): String =
        checkNotNull(FixtureFile::class.java.classLoader?.getResourceAsStream(path)) { "픽스처 없음: $path" }
            .bufferedReader().use { it.readText() }
}
