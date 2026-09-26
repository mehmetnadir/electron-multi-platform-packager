package android.content;
/** JVM test saplaması — yalnız EmppGRota'nın derlenmesi için. */
public abstract class Context {
    public Context getApplicationContext() { return this; }
    public java.io.File getFilesDir() { return null; }
    public android.content.pm.PackageManager getPackageManager() { return null; }
    public String getPackageName() { return "test"; }
}
