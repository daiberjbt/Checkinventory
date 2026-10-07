import React, { useState } from 'react';
import { motion } from 'motion/react';
import { Mail, Lock, Shield, Users, ArrowRight, User as UserIcon, Key, Eye, EyeOff } from 'lucide-react';
import { auth, db } from '../firebase';
import { 
  createUserWithEmailAndPassword, 
  signInWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
  signOut
} from 'firebase/auth';
import { doc, setDoc, getDoc, query, where, collection, getDocs, writeBatch, serverTimestamp } from 'firebase/firestore';
import { UserRole } from '../types';

export const Auth: React.FC = () => {
  const [isLogin, setIsLogin] = useState(true);
  const [isForgotPassword, setIsForgotPassword] = useState(false);
  const [email, setEmail] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [role, setRole] = useState<UserRole>('admin');
  const [adminEmail, setAdminEmail] = useState('');
  const [licenseCode, setLicenseCode] = useState('');
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [loading, setLoading] = useState(false);

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccessMessage('');
    setLoading(true);

    try {
      await sendPasswordResetEmail(auth, email, {
        url: window.location.origin,
      });
      setSuccessMessage('Se ha enviado un correo para restablecer tu contraseña. Por favor revisa tu bandeja de entrada.');
      setIsForgotPassword(false);
    } catch (err: any) {
      console.error(err);
      if (err.code === 'auth/user-not-found') {
        setError('No existe una cuenta con este correo electrónico.');
      } else {
        setError('Ocurrió un error al intentar enviar el correo de recuperación.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isForgotPassword) {
      return handleForgotPassword(e);
    }
    setError('');
    setSuccessMessage('');
    setLoading(true);

    try {
      if (isLogin) {
        await signInWithEmailAndPassword(auth, email, password);
      } else {
        if (password !== confirmPassword) {
          setError('Las contraseñas no coinciden');
          setLoading(false);
          return;
        }

        const isBootstrapAdmin = email.trim().toLowerCase() === 'djbtorreglosa@gmail.com';
        const cleanedLicenseCode = licenseCode.trim().toUpperCase();

        if (role === 'admin' && !isBootstrapAdmin && !cleanedLicenseCode) {
          setError('Por favor ingresa un código de activación de licencia de 6 meses para registrarte como Administrador.');
          setLoading(false);
          return;
        }

        let user;
        let isExistingAuthAccount = false;

        try {
          const userCredential = await createUserWithEmailAndPassword(auth, email, password);
          user = userCredential.user;
        } catch (authCreateErr: any) {
          if (authCreateErr.code === 'auth/email-already-in-use') {
            // Check if we can sign in with the provided password to reconcile the account
            try {
              const signCred = await signInWithEmailAndPassword(auth, email, password);
              user = signCred.user;
              isExistingAuthAccount = true;
            } catch (signInErr: any) {
              if (signInErr.code === 'auth/wrong-password' || signInErr.code === 'auth/invalid-credential') {
                setError('Este correo electrónico ya está registrado en el sistema de autenticación. Por favor inicia sesión con tu contraseña o usa "¿Olvidaste tu contraseña?" para restablecerla.');
                setIsLogin(true);
                setLoading(false);
                return;
              }
              throw authCreateErr;
            }
          } else {
            throw authCreateErr;
          }
        }

        let adminUid = null;
        let adminName = null;
        if (role === 'dependent') {
          // Check if adminEmail exists and is an admin
          const q = query(collection(db, 'users'), where('email', '==', adminEmail.trim().toLowerCase()), where('role', '==', 'admin'));
          const querySnapshot = await getDocs(q);
          
          if (querySnapshot.empty) {
            if (!isExistingAuthAccount && user) {
              try { await user.delete(); } catch (e) { /* ignore */ }
            }
            setError('El correo proporcionado no corresponde a un administrador registrado.');
            setLoading(false);
            return;
          }
          const adminDoc = querySnapshot.docs[0];
          adminUid = adminDoc.id;
          const adminData = adminDoc.data();
          adminName = `${adminData.firstName || ''} ${adminData.lastName || ''}`.trim() || adminData.email;
        }

        let licenseDocRef = null;
        let expirationDateIso = null;

        if (role === 'admin') {
          if (!isBootstrapAdmin && cleanedLicenseCode) {
            licenseDocRef = doc(db, 'licenses', cleanedLicenseCode);
            try {
              const licenseSnap = await getDoc(licenseDocRef);

              if (licenseSnap.exists()) {
                const licenseData = licenseSnap.data() as any;
                if (licenseData?.isUsed && licenseData?.assignedTo !== user.uid) {
                  if (!isExistingAuthAccount && user) {
                    try { await user.delete(); } catch (e) { /* ignore */ }
                  }
                  setError('Este código de activación ya ha sido utilizado.');
                  setLoading(false);
                  return;
                }
              }
            } catch (licErr) {
              console.warn('Licence check warning:', licErr);
            }

            const expiration = new Date();
            expiration.setDate(expiration.getDate() + 180); // 6 months (180 days)
            expirationDateIso = expiration.toISOString();
          } else {
            const expiration = new Date();
            expiration.setFullYear(expiration.getFullYear() + 10);
            expirationDateIso = expiration.toISOString();
          }
        }

        // Try to send verification email (non-blocking if service is disabled in dev)
        try {
          await sendEmailVerification(user, {
            url: window.location.origin,
            handleCodeInApp: false,
          });
        } catch (emailErr) {
          console.warn('Verification email notice (handled):', emailErr);
        }

        // Store role in Firestore
        const userRef = doc(db, 'users', user.uid);
        const userData: any = {
          email: email.trim().toLowerCase(),
          firstName: firstName.trim() || 'Usuario',
          lastName: lastName.trim() || '',
          role,
          adminEmail: role === 'dependent' ? adminEmail.trim().toLowerCase() : null,
          adminUid: role === 'dependent' ? adminUid : null,
          adminName: role === 'dependent' ? adminName : null,
          hasSeenOnboarding: false,
          createdAt: new Date().toISOString(),
          isPremium: role === 'admin',
          plan: role === 'admin' ? 'license' : null,
          expirationDate: expirationDateIso,
          licenseCode: role === 'admin' && !isBootstrapAdmin ? cleanedLicenseCode : null,
          isActive: true,
          isDeleted: false,
        };

        // Use a batch to ensure atomicity
        const batch = writeBatch(db);
        batch.set(userRef, userData, { merge: true });

        if (licenseDocRef && role === 'admin' && !isBootstrapAdmin) {
          try {
            batch.update(licenseDocRef, {
              isUsed: true,
              assignedTo: user.uid,
              assignedEmail: email,
              activatedAt: new Date().toISOString(),
              expiresAt: expirationDateIso,
            });
          } catch (licBatchErr) {
            console.warn('License batch update notice:', licBatchErr);
          }
        }

        await batch.commit();

        if (isExistingAuthAccount) {
          setSuccessMessage('¡Cuenta sincronizada y activada con éxito en la base de datos!');
        } else {
          setSuccessMessage('¡Cuenta creada con éxito! Por favor verifica tu correo electrónico para continuar. Hemos enviado un enlace de confirmación.');
          setIsLogin(true);
        }
      }
    } catch (err: any) {
      console.error(err);
      if (auth.currentUser) {
        await signOut(auth);
      }
      if (err.code === 'auth/user-not-found') {
        setError('Este correo no está registrado. ¿Deseas crear una cuenta?');
      } else if (err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
        setError('Credenciales incorrectas. Verifica tu correo y contraseña.');
      } else if (err.code === 'auth/email-already-in-use') {
        setError('Este correo electrónico ya está registrado. Hemos cambiado a la pestaña de Iniciar Sesión para que puedas ingresar con tu contraseña.');
        setIsLogin(true);
      } else {
        setError('Ocurrió un error: ' + (err.message || 'Inténtalo de nuevo.'));
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#f8f9fa] flex items-center justify-center p-6">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-md w-full"
      >
        <div className="text-center mb-10">
          <div className="w-16 h-16 bg-black rounded-2xl flex items-center justify-center text-white mx-auto mb-6 shadow-2xl shadow-black/20">
            <Shield size={32} />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">CheckInventory</h1>
          <p className="text-muted text-sm mt-2">Sistema de Inventarios Profesionales</p>
        </div>

        <div className="bg-white rounded-[3rem] p-8 shadow-xl border border-black/5">
          {!isForgotPassword && (
            <div className="flex bg-[#f8f9fa] p-1 rounded-2xl mb-8">
              <button 
                onClick={() => {
                  setIsLogin(true);
                  setIsForgotPassword(false);
                  setError('');
                  setSuccessMessage('');
                }}
                className={`flex-1 py-3 rounded-xl text-sm font-bold transition-all ${isLogin ? 'bg-white shadow-sm' : 'text-muted'}`}
              >
                Iniciar Sesión
              </button>
              <button 
                onClick={() => {
                  setIsLogin(false);
                  setIsForgotPassword(false);
                  setError('');
                  setSuccessMessage('');
                }}
                className={`flex-1 py-3 rounded-xl text-sm font-bold transition-all ${!isLogin ? 'bg-white shadow-sm' : 'text-muted'}`}
              >
                Registrarse
              </button>
            </div>
          )}

          {isForgotPassword && (
            <div className="mb-8">
              <h2 className="text-xl font-bold">Recuperar Contraseña</h2>
              <p className="text-muted text-xs mt-1">Ingresa tu correo para recibir un enlace de recuperación.</p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-2">
              <label className="text-[10px] font-bold uppercase tracking-widest text-muted ml-1">Correo Electrónico</label>
              <div className="relative">
                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-muted opacity-40" size={18} />
                <input 
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full bg-[#f8f9fa] border border-black/5 rounded-2xl pl-12 pr-4 py-4 focus:ring-2 focus:ring-black outline-none transition-all"
                  placeholder="admin@ejemplo.com"
                />
              </div>
            </div>

            {!isForgotPassword && (
              <div className="space-y-2">
                <label className="text-[10px] font-bold uppercase tracking-widest text-muted ml-1">Contraseña</label>
                <div className="relative">
                  <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-muted opacity-40" size={18} />
                  <input 
                    type={showPassword ? "text" : "password"}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full bg-[#f8f9fa] border border-black/5 rounded-2xl pl-12 pr-12 py-4 focus:ring-2 focus:ring-black outline-none transition-all"
                    placeholder="••••••••"
                  />
                  <button
                    type="button"
                    id="toggle-auth-password-visibility-btn"
                    onClick={() => setShowPassword(prev => !prev)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-muted hover:text-black transition-colors p-1"
                    title={showPassword ? "Ocultar contraseña" : "Ver contraseña"}
                    aria-label={showPassword ? "Ocultar contraseña" : "Ver contraseña"}
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
                {isLogin && (
                  <button 
                    type="button"
                    onClick={() => {
                      setIsForgotPassword(true);
                      setError('');
                      setSuccessMessage('');
                    }}
                    className="text-[10px] font-bold uppercase tracking-widest text-muted hover:text-black transition-colors ml-1"
                  >
                    ¿Olvidaste tu contraseña?
                  </button>
                )}
              </div>
            )}

            {!isLogin && !isForgotPassword && (
              <motion.div 
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                className="space-y-6"
              >
                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted ml-1">Confirmar Contraseña</label>
                  <div className="relative">
                    <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-muted opacity-40" size={18} />
                    <input 
                      type={showConfirmPassword ? "text" : "password"}
                      required
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      className="w-full bg-[#f8f9fa] border border-black/5 rounded-2xl pl-12 pr-12 py-4 focus:ring-2 focus:ring-black outline-none transition-all"
                      placeholder="••••••••"
                    />
                    <button
                      type="button"
                      id="toggle-auth-confirm-password-visibility-btn"
                      onClick={() => setShowConfirmPassword(prev => !prev)}
                      className="absolute right-4 top-1/2 -translate-y-1/2 text-muted hover:text-black transition-colors p-1"
                      title={showConfirmPassword ? "Ocultar contraseña" : "Ver contraseña"}
                      aria-label={showConfirmPassword ? "Ocultar contraseña" : "Ver contraseña"}
                    >
                      {showConfirmPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-muted ml-1">Nombre</label>
                    <div className="relative">
                      <UserIcon className="absolute left-4 top-1/2 -translate-y-1/2 text-muted opacity-40" size={18} />
                      <input 
                        type="text"
                        required
                        value={firstName}
                        onChange={(e) => setFirstName(e.target.value)}
                        className="w-full bg-[#f8f9fa] border border-black/5 rounded-2xl pl-12 pr-4 py-4 focus:ring-2 focus:ring-black outline-none transition-all"
                        placeholder="Juan"
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-muted ml-1">Apellido</label>
                    <div className="relative">
                      <UserIcon className="absolute left-4 top-1/2 -translate-y-1/2 text-muted opacity-40" size={18} />
                      <input 
                        type="text"
                        required
                        value={lastName}
                        onChange={(e) => setLastName(e.target.value)}
                        className="w-full bg-[#f8f9fa] border border-black/5 rounded-2xl pl-12 pr-4 py-4 focus:ring-2 focus:ring-black outline-none transition-all"
                        placeholder="Pérez"
                      />
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted ml-1">Tipo de Cuenta</label>
                  <div className="grid grid-cols-2 gap-4">
                    <button
                      type="button"
                      onClick={() => setRole('admin')}
                      className={`p-4 rounded-2xl border transition-all flex flex-col items-center gap-2 ${role === 'admin' ? 'border-black bg-black text-white' : 'border-black/5 bg-[#f8f9fa] text-muted'}`}
                    >
                      <Shield size={20} />
                      <span className="text-[10px] font-bold uppercase">Administrador</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setRole('dependent')}
                      className={`p-4 rounded-2xl border transition-all flex flex-col items-center gap-2 ${role === 'dependent' ? 'border-black bg-black text-white' : 'border-black/5 bg-[#f8f9fa] text-muted'}`}
                    >
                      <Users size={20} />
                      <span className="text-[10px] font-bold uppercase">Dependiente</span>
                    </button>
                  </div>
                </div>

                {role === 'admin' && (
                  <motion.div 
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="space-y-4"
                  >
                    <div className="space-y-2">
                      <label className="text-[10px] font-bold uppercase tracking-widest text-muted ml-1 flex items-center justify-between">
                        <span>Código de Activación (Licencia 6 Meses)</span>
                        {email.trim().toLowerCase() === 'djbtorreglosa@gmail.com' && (
                          <span className="text-[10px] text-emerald-600 font-bold">Admin Principal (Exento)</span>
                        )}
                      </label>
                      <div className="relative">
                        <Key className="absolute left-4 top-1/2 -translate-y-1/2 text-muted opacity-40" size={18} />
                        <input 
                          type="text"
                          required={email.trim().toLowerCase() !== 'djbtorreglosa@gmail.com'}
                          value={licenseCode}
                          onChange={(e) => setLicenseCode(e.target.value.toUpperCase())}
                          className="w-full bg-[#f8f9fa] border border-black/5 rounded-2xl pl-12 pr-4 py-4 focus:ring-2 focus:ring-black outline-none transition-all font-mono uppercase placeholder:normal-case"
                          placeholder="CHK-6M-XXXX-XXXX"
                        />
                      </div>
                    </div>

                    <div className="bg-black/5 p-4 rounded-2xl border border-black/5 text-center">
                      <p className="text-xs font-bold text-black">Licencia Temporal de 6 Meses</p>
                      <p className="text-[11px] text-muted mt-1">El acceso a la app se activa mediante un código de licencia válido por 180 días.</p>
                      <a 
                        href="https://wa.me/573000000000?text=Hola,%20deseo%20comprar%20el%20código%20de%20activación%20de%20la%20licencia%20temporal%20de%206%20meses%20para%20CheckInventory" 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="mt-3 inline-flex items-center justify-center gap-2 text-xs font-bold text-black underline hover:text-black/70 transition-colors"
                      >
                        ¿No tienes un código? Adquirir licencia aquí
                      </a>
                    </div>
                  </motion.div>
                )}

                {role === 'dependent' && (
                  <motion.div 
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="space-y-2"
                  >
                    <label className="text-[10px] font-bold uppercase tracking-widest text-muted ml-1">Correo del Administrador</label>
                    <div className="relative">
                      <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-muted opacity-40" size={18} />
                      <input 
                        type="email"
                        required
                        value={adminEmail}
                        onChange={(e) => setAdminEmail(e.target.value)}
                        className="w-full bg-[#f8f9fa] border border-black/5 rounded-2xl pl-12 pr-4 py-4 focus:ring-2 focus:ring-black outline-none transition-all"
                        placeholder="admin@empresa.com"
                      />
                    </div>
                  </motion.div>
                )}
              </motion.div>
            )}

            {successMessage && (
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="bg-emerald-50 text-emerald-700 p-4 rounded-2xl text-xs font-bold text-center"
              >
                {successMessage}
              </motion.div>
            )}

            {error && (
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="text-red-500 text-xs font-bold text-center space-y-2"
              >
                <p>{error}</p>
                {error.includes('no está registrado') && (
                  <button 
                    type="button"
                    onClick={() => {
                      setIsLogin(false);
                      setError('');
                    }}
                    className="text-black underline block mx-auto"
                  >
                    Registrarse ahora
                  </button>
                )}
              </motion.div>
            )}

            <div className="space-y-4">
              <button 
                type="submit"
                disabled={loading}
                className="w-full bg-black text-white py-4 rounded-2xl font-bold hover:bg-black/80 transition-all flex items-center justify-center gap-2 shadow-xl shadow-black/10 disabled:opacity-50"
              >
                {loading ? 'Procesando...' : (isForgotPassword ? 'Enviar Enlace' : (isLogin ? 'Entrar' : 'Crear Cuenta'))}
                {!loading && <ArrowRight size={18} />}
              </button>

              {isForgotPassword && (
                <button 
                  type="button"
                  onClick={() => {
                    setIsForgotPassword(false);
                    setError('');
                    setSuccessMessage('');
                  }}
                  className="w-full py-2 text-[10px] font-bold uppercase tracking-widest text-muted hover:text-black transition-colors"
                >
                  Volver al inicio de sesión
                </button>
              )}
            </div>
          </form>
        </div>
      </motion.div>
    </div>
  );
};
