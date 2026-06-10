const getCurrentYear = () => new Date().getFullYear();

const Footer = () => {
  return (
    <footer className="footer">
      <div className="footer-row">
        <span>&copy; {getCurrentYear()} Chattiq. All rights reserved.</span>
        <a
          href="/privacy-policy"
          className="privacy-policy-url"
        >
          Privacy Policy
        </a>
      </div>
    </footer>
  );
};

export default Footer;
