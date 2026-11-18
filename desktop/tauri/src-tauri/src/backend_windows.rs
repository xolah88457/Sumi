use std::{
    io,
    os::windows::{
        io::{AsRawHandle, FromRawHandle, OwnedHandle},
        process::{ChildExt, CommandExt},
    },
    process::{Child, Command},
    ptr::null,
};
use windows_sys::Win32::System::{
    JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
        SetInformationJobObject, TerminateJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    },
    Threading::{ResumeThread, CREATE_NO_WINDOW, CREATE_SUSPENDED},
};

pub struct Job(OwnedHandle);

impl Job {
    pub fn spawn(cmd: &mut Command) -> io::Result<(Child, Self)> {
        let raw = unsafe { CreateJobObjectW(null(), null()) };
        if raw.is_null() {
            return Err(io::Error::last_os_error());
        }
        let job = Self(unsafe { OwnedHandle::from_raw_handle(raw) });
        let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        if unsafe {
            SetInformationJobObject(
                raw,
                JobObjectExtendedLimitInformation,
                (&limits as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(),
                std::mem::size_of_val(&limits) as u32,
            )
        } == 0
        {
            return Err(io::Error::last_os_error());
        }
        // Assign the suspended process before any Node code or descendants can run.
        let mut child = cmd
            .creation_flags(CREATE_SUSPENDED | CREATE_NO_WINDOW)
            .spawn()?;
        if unsafe { AssignProcessToJobObject(raw, child.as_raw_handle()) } == 0
            || unsafe { ResumeThread(child.main_thread_handle().as_raw_handle()) } == u32::MAX
        {
            let err = io::Error::last_os_error();
            let _ = child.kill();
            let _ = child.wait();
            return Err(err);
        }
        Ok((child, job))
    }

    pub fn stop(&self, child: &mut Child) {
        if unsafe { TerminateJobObject(self.0.as_raw_handle(), 1) } == 0 {
            eprintln!(
                "Could not terminate Sumi's backend job: {}",
                io::Error::last_os_error()
            );
            let _ = child.kill();
        }
        let _ = child.wait();
    }
}
